import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { getAppUser } from "./firebase";
import {
  saveOAuthIntegration,
  OAuthAccount,
  slugify,
  getConnectors,
  MAX_ACCOUNTS_PER_PROVIDER,
  OAuthAccountLimitError,
  OAuthAccountAlreadyConnectedError,
} from "./storage";

/**
 * Client-side pre-check before opening the OAuth browser sheet — avoids
 * wasting the user's time on a full auth flow that would fail at the very
 * end anyway. saveOAuthIntegration's own transaction re-checks this cap
 * again as defense-in-depth against a race between two concurrent connect
 * attempts, so this pre-check is a UX optimization, not the only
 * enforcement.
 */
async function checkAccountCap(providerId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const connectors = await getConnectors();
  const connector = connectors.find((c) => c.id === (providerId as any));
  if (connector && connector.accountCount >= MAX_ACCOUNTS_PER_PROVIDER) {
    return { ok: false, error: `You can connect up to ${MAX_ACCOUNTS_PER_PROVIDER} ${providerId} accounts. Disconnect one first.` };
  }
  return { ok: true };
}

// Complete the auth session if redirecting back to the same page
WebBrowser.maybeCompleteAuthSession();

export interface ConnectionResult {
  success: boolean;
  email?: string;
  // Slack rarely returns an email (users:read.email isn't requested) — the
  // connectors UI falls back to workspace/display name when email is absent.
  teamName?: string;
  displayName?: string;
  error?: string;
}

// Helpers for PKCE (Proof Key for Code Exchange)
function generateCodeVerifier(): string {
  const charset =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let result = "";
  for (let i = 0; i < 64; i++) {
    result += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return result;
}

/**
 * Initiates Gmail (Google OAuth) connection using the iOS Client ID from GoogleOauth.plist.
 * Performs a standard PKCE authorization code flow.
 */
export async function initiateGmailConnection(): Promise<{
  success: boolean;
  email?: string;
  error?: string;
}> {
  // Configured client credentials from GoogleOauth.plist
  const clientId =
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || "";
  const reversedClientId =
    process.env.EXPO_PUBLIC_GOOGLE_REVERSED_CLIENT_ID || "";
  const redirectUrl = `${reversedClientId}:/oauthredirect`;

  try {
    const user = getAppUser();
    if (!user) {
      return {
        success: false,
        error: "User must be logged in to connect integrations.",
      };
    }

    const capCheck = await checkAccountCap("gmail");
    if (!capCheck.ok) return { success: false, error: capCheck.error };

    // drive.readonly is intentionally NOT requested here — Drive access is
    // a separate, opt-in incremental-authorization flow (see
    // initiateGoogleDriveConnection below), shown to the user only when
    // they explicitly choose to connect Drive rather than bundled silently
    // into the primary mail/calendar connect.
    const scopes = [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/contacts.readonly",
      "https://www.googleapis.com/auth/contacts.other.readonly",
      "https://www.googleapis.com/auth/calendar",
    ];

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = codeVerifier; // Plain challenge method is 100% compatible and doesn't require crypto library

    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUrl)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scopes.join(" "))}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&code_challenge=${encodeURIComponent(codeChallenge)}` +
      `&code_challenge_method=plain`;

    console.log("[Google OAuth] Initiating flow with authUrl:", authUrl);
    console.log("[Google OAuth] Expecting redirect to:", redirectUrl);

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl, { preferEphemeralSession: true });

    if (result.type === "success" && result.url) {
      console.log("[Google OAuth] Redirected back with URL:", result.url);
      const urlObj = Linking.parse(result.url);
      const code = urlObj.queryParams?.code;
      if (!code || typeof code !== "string") {
        return {
          success: false,
          error: "Authorization code not found or invalid in redirect URL.",
        };
      }

      console.log("[Google OAuth] Exchanging code for tokens...");
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          redirect_uri: redirectUrl,
          grant_type: "authorization_code",
          code_verifier: codeVerifier,
        }).toString(),
      });

      if (response.ok) {
        const tokens = await response.json();
        const accessToken = tokens.access_token;
        const refreshToken = tokens.refresh_token || "";
        const expiryDate = new Date(
          Date.now() + tokens.expires_in * 1000,
        ).toISOString();
        let email = "connected.user@gmail.com";

        console.log(
          "[Google OAuth] Token exchange successful. Fetching user email...",
        );
        // Fetch the user's email using the access token
        try {
          const userRes = await fetch(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            {
              headers: { Authorization: `Bearer ${accessToken}` },
            },
          );
          if (userRes.ok) {
            const userData = await userRes.json();
            email = userData.email || email;
          }
        } catch (err) {
          console.error("[Google OAuth] Failed to fetch user info:", err);
        }

        const grantedScopes = tokens.scope ? tokens.scope.split(" ") : scopes;

        // Computed once, reused across BOTH saveOAuthIntegration calls below
        // (initial connect, then again after the watch registers) so the
        // second call merges into the SAME array entry instead of a
        // duplicate — see saveOAuthIntegration's allowReconnect option.
        const accountId = slugify(email);
        const integration: OAuthAccount = {
          accountId,
          isDefault: false, // saveOAuthIntegration decides the real value
          provider: "google",
          email,
          accessToken,
          refreshToken,
          expiryDate,
          scopes: grantedScopes,
          status: "active",
          connectedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        console.log(
          "[Google OAuth] Saving integration details to Firestore...",
        );
        await saveOAuthIntegration(user.uid, "gmail", integration);

        // Call watch API to register Gmail push notifications
        console.log(
          "[Google OAuth] Registering watch for push notifications...",
        );
        const watchExpiration = await registerGmailWatch(accessToken);
        if (watchExpiration) {
          console.log("[Google OAuth] Gmail watch registered successfully!");
          await saveOAuthIntegration(user.uid, "gmail", {
            ...integration,
            meta: { watchExpiration },
          }, { allowReconnect: true });
        } else {
          console.warn(
            "[Google OAuth] Gmail watch registration failed. Check GGC Pub/Sub permissions.",
          );
        }

        return { success: true, email };
      } else {
        const errText = await response.text();
        console.error("[Google OAuth] Token exchange failed:", errText);
        return { success: false, error: `Failed to exchange code: ${errText}` };
      }
    }

    return { success: false, error: "Authentication was cancelled or failed." };
  } catch (e: any) {
    console.error("[Google OAuth] Error:", e);
    return {
      success: false,
      error: e.message || "An error occurred during authentication.",
    };
  }
}

/**
 * Calls Google's Gmail API watch endpoint to register push notifications to
 * Google Pub/Sub. Returns the watch's expiration (Gmail caps this at 7 days
 * — see renewGmailWatch in functions/src/index.ts for the renewal job that
 * re-calls this before it lapses) as an ISO string, or null on failure.
 */
async function registerGmailWatch(accessToken: string): Promise<string | null> {
  const topicName = process.env.EXPO_PUBLIC_GMAIL_PUBSUB_TOPIC || "";
  try {
    const response = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/watch",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topicName,
          labelIds: ["INBOX"],
        }),
      },
    );

    if (response.ok) {
      const data = await response.json();
      console.log("[Google OAuth] Gmail watch response:", JSON.stringify(data));
      // Gmail returns `expiration` as a string epoch-millis timestamp, not an ISO string.
      return new Date(Number(data.expiration)).toISOString();
    } else {
      const errText = await response.text();
      console.error("[Google OAuth] Failed to register watch:", errText);
      return null;
    }
  } catch (e) {
    console.error("[Google OAuth] Network error calling Gmail watch:", e);
    return null;
  }
}

/**
 * Initiates a fully STANDALONE Google Drive connection — its own OAuth
 * round-trip, its own token, saved as its own top-level `integrations.drive`
 * doc (see saveOAuthIntegration). No dependency on Gmail being connected,
 * and no requirement that it be the same Google account — the user can
 * connect Drive under an entirely different account than their Gmail if
 * they choose. Requests userinfo.email (not just drive.readonly) since
 * there's no existing Gmail integration to borrow an email address from.
 */
export async function initiateGoogleDriveConnection(): Promise<ConnectionResult> {
  const clientId =
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || "";
  const reversedClientId =
    process.env.EXPO_PUBLIC_GOOGLE_REVERSED_CLIENT_ID || "";
  const redirectUrl = `${reversedClientId}:/oauthredirect`;

  try {
    const user = getAppUser();
    if (!user) {
      return {
        success: false,
        error: "User must be logged in to connect integrations.",
      };
    }

    const capCheck = await checkAccountCap("drive");
    if (!capCheck.ok) return { success: false, error: capCheck.error };

    const scopes = [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ];

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = codeVerifier;

    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUrl)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scopes.join(" "))}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&code_challenge=${encodeURIComponent(codeChallenge)}` +
      `&code_challenge_method=plain`;

    console.log("[Google OAuth] Initiating standalone Drive flow with authUrl:", authUrl);

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl, { preferEphemeralSession: true });

    if (result.type === "success" && result.url) {
      const urlObj = Linking.parse(result.url);
      const code = urlObj.queryParams?.code;
      if (!code || typeof code !== "string") {
        return {
          success: false,
          error: "Authorization code not found or invalid in redirect URL.",
        };
      }

      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          redirect_uri: redirectUrl,
          grant_type: "authorization_code",
          code_verifier: codeVerifier,
        }).toString(),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("[Google OAuth] Drive token exchange failed:", errText);
        return { success: false, error: `Failed to exchange code: ${errText}` };
      }

      const tokens = await response.json();
      const accessToken = tokens.access_token;
      const refreshToken = tokens.refresh_token || "";
      const expiryDate = new Date(
        Date.now() + tokens.expires_in * 1000,
      ).toISOString();
      const grantedScopes = tokens.scope ? tokens.scope.split(" ") : scopes;

      let email = "connected.user@gmail.com";
      try {
        const userRes = await fetch(
          "https://www.googleapis.com/oauth2/v2/userinfo",
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (userRes.ok) {
          const userData = await userRes.json();
          email = userData.email || email;
        }
      } catch (err) {
        console.error("[Google OAuth] Failed to fetch Drive account email:", err);
      }

      const integration: OAuthAccount = {
        accountId: slugify(email),
        isDefault: false,
        provider: "google",
        email,
        accessToken,
        refreshToken,
        expiryDate,
        scopes: grantedScopes,
        status: "active",
        connectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await saveOAuthIntegration(user.uid, "drive", integration);

      return { success: true, email };
    }

    return { success: false, error: "Authentication was cancelled or failed." };
  } catch (e: any) {
    console.error("[Google OAuth] Drive connection error:", e);
    return {
      success: false,
      error: e.message || "An error occurred during authentication.",
    };
  }
}

/**
 * Initiates Outlook (Microsoft Graph OAuth) connection via PKCE against the
 * `common` multi-tenant endpoint, so both work/school and personal
 * Outlook.com accounts can connect. Requires an Azure AD app registration —
 * see the "Prerequisites" section of the Outlook integration plan for the
 * one-time manual setup this depends on (Application (client) ID configured
 * via the MICROSOFT_CLIENT_ID env var / EXPO_PUBLIC_MICROSOFT_CLIENT_ID).
 */
export async function initiateOutlookConnection(): Promise<{
  success: boolean;
  email?: string;
  error?: string;
}> {
  const clientId = process.env.EXPO_PUBLIC_MICROSOFT_CLIENT_ID || "";
  if (!clientId) {
    return {
      success: false,
      error: "Outlook connection is not configured (missing Microsoft client ID).",
    };
  }

  // Fixed custom-scheme redirect (registered as a native redirect URI in the
  // Azure AD app registration) — matches the existing Gmail flow's use of a
  // stable, app-config-registered scheme (see app.json "scheme") rather than
  // a dynamically-computed Linking.createURL, whose behavior is explicitly
  // undefined for Expo Go / published updates per the Expo docs.
  const redirectUrl = "app.synced.it://oauthredirect";

  try {
    const user = getAppUser();
    if (!user) {
      return {
        success: false,
        error: "User must be logged in to connect integrations.",
      };
    }

    const capCheck = await checkAccountCap("outlook");
    if (!capCheck.ok) return { success: false, error: capCheck.error };

    // Files.Read is intentionally NOT requested here — OneDrive access is a
    // separate, opt-in incremental-authorization flow (see
    // initiateOneDriveConnection below), shown to the user only when they
    // explicitly choose to connect OneDrive rather than bundled silently
    // into the primary mail/calendar connect.
    const scopes = [
      "Mail.Read",
      "Mail.Send",
      "Mail.ReadWrite",
      "Calendars.ReadWrite",
      "User.Read",
      "offline_access",
    ];

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = codeVerifier;

    const authUrl =
      `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
      `client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUrl)}` +
      `&response_type=code` +
      `&response_mode=query` +
      `&scope=${encodeURIComponent(scopes.join(" "))}` +
      `&code_challenge=${encodeURIComponent(codeChallenge)}` +
      `&code_challenge_method=plain`;

    console.log("[Microsoft OAuth] Initiating flow with authUrl:", authUrl);
    console.log("[Microsoft OAuth] Expecting redirect to:", redirectUrl);

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl, { preferEphemeralSession: true });

    if (result.type === "success" && result.url) {
      console.log("[Microsoft OAuth] Redirected back with URL:", result.url);
      const urlObj = Linking.parse(result.url);
      const code = urlObj.queryParams?.code;
      if (!code || typeof code !== "string") {
        return {
          success: false,
          error: "Authorization code not found or invalid in redirect URL.",
        };
      }

      console.log("[Microsoft OAuth] Exchanging code for tokens...");
      const response = await fetch(
        "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            redirect_uri: redirectUrl,
            grant_type: "authorization_code",
            code_verifier: codeVerifier,
            scope: scopes.join(" "),
          }).toString(),
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        console.error("[Microsoft OAuth] Token exchange failed:", errText);
        return { success: false, error: `Failed to exchange code: ${errText}` };
      }

      const tokens = await response.json();
      const accessToken = tokens.access_token;
      const refreshToken = tokens.refresh_token || "";
      const expiryDate = new Date(
        Date.now() + tokens.expires_in * 1000,
      ).toISOString();
      let email = "connected.user@outlook.com";

      console.log(
        "[Microsoft OAuth] Token exchange successful. Fetching user profile...",
      );
      try {
        const userRes = await fetch("https://graph.microsoft.com/v1.0/me", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (userRes.ok) {
          const userData = await userRes.json();
          email = userData.mail || userData.userPrincipalName || email;
        }
      } catch (err) {
        console.error("[Microsoft OAuth] Failed to fetch user profile:", err);
      }

      const grantedScopes = tokens.scope ? tokens.scope.split(" ") : scopes;

      // Graph's subscription requires a shared secret (clientState) the
      // webhook verifies every notification against, since Graph carries no
      // other signature — generated fresh per connection. Shared across both
      // the Inbox and Sent Items subscriptions below (one secret per
      // mailbox connection is enough — Graph itself is what tells the
      // webhook apart by subscriptionId, not by clientState).
      const clientState =
        generateCodeVerifier() + generateCodeVerifier();

      const notificationUrl = process.env.EXPO_PUBLIC_OUTLOOK_WEBHOOK_URL || "";
      if (!notificationUrl) {
        console.warn(
          "[Microsoft OAuth] EXPO_PUBLIC_OUTLOOK_WEBHOOK_URL not configured — skipping subscription creation. Inbound Outlook email will not be ingested until this is set and the account is reconnected.",
        );
      }

      // Creates one Graph change-notification subscription on a single mail
      // folder. Called once for Inbox (inbound mail — unchanged from
      // before) and once for Sent Items (see the sentSubscriptionId/
      // sentSubscriptionExpiresAt fields below) — Graph's delta/subscription
      // model is scoped per FOLDER, unlike Gmail's mailbox-wide history.list,
      // so a self-sent reply (which lands in Sent Items, never Inbox) needs
      // its own dedicated subscription to be observed at all. CONFIRMED real
      // gap this fixes: without a Sent Items subscription, the webhook never
      // fired for a self-sent Outlook reply, so it never got summarized into
      // the conversation view the way a self-sent Gmail reply already does
      // (see processSelfSentMessage in functions/src/index.ts).
      async function createGraphMailSubscription(
        folder: "Inbox" | "SentItems",
      ): Promise<{ subscriptionId?: string; subscriptionExpiresAt?: string }> {
        if (!notificationUrl) return {};
        try {
          const expiresAt = new Date(Date.now() + 4230 * 60 * 1000).toISOString();
          const subRes = await fetch(
            "https://graph.microsoft.com/v1.0/subscriptions",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                changeType: "created",
                notificationUrl,
                resource: `me/mailFolders('${folder}')/messages`,
                expirationDateTime: expiresAt,
                clientState,
              }),
            },
          );
          if (subRes.ok) {
            const subData = await subRes.json();
            console.log(`[Microsoft OAuth] Graph ${folder} subscription created:`, subData.id);
            return { subscriptionId: subData.id, subscriptionExpiresAt: expiresAt };
          }
          const errText = await subRes.text();
          console.warn(`[Microsoft OAuth] Graph ${folder} subscription creation failed:`, errText);
        } catch (err) {
          console.warn(`[Microsoft OAuth] Graph ${folder} subscription creation error:`, err);
        }
        return {};
      }

      const { subscriptionId, subscriptionExpiresAt } = await createGraphMailSubscription("Inbox");
      const { subscriptionId: sentSubscriptionId, subscriptionExpiresAt: sentSubscriptionExpiresAt } =
        await createGraphMailSubscription("SentItems");

      const integration: OAuthAccount = {
        accountId: slugify(email),
        isDefault: false,
        provider: "microsoft",
        email,
        accessToken,
        refreshToken,
        expiryDate,
        scopes: grantedScopes,
        status: "active",
        connectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        meta: {
          clientState,
          ...(subscriptionId ? { subscriptionId } : {}),
          ...(subscriptionExpiresAt ? { subscriptionExpiresAt } : {}),
          // Sent Items subscription (see createGraphMailSubscription above)
          // — deliberately separate field names from the Inbox pair rather
          // than a nested/renamed shape, so every existing reader of
          // meta.subscriptionId (renewal cron, disconnect flows) keeps
          // working unchanged for the Inbox subscription.
          ...(sentSubscriptionId ? { sentSubscriptionId } : {}),
          ...(sentSubscriptionExpiresAt ? { sentSubscriptionExpiresAt } : {}),
        },
      };

      console.log("[Microsoft OAuth] Saving integration details to Firestore...");
      await saveOAuthIntegration(user.uid, "outlook", integration);

      return { success: true, email };
    }

    return { success: false, error: "Authentication was cancelled or failed." };
  } catch (e: any) {
    console.error("[Microsoft OAuth] Error:", e);
    return {
      success: false,
      error: e.message || "An error occurred during authentication.",
    };
  }
}

/**
 * Revokes the Graph mail subscription for a connected Outlook account so it
 * stops POSTing notifications for a mailbox the user is disconnecting.
 * Best-effort — a failure here (e.g. token already invalid) should not block
 * the local disconnect, since removeOAuthIntegration deletes the stored
 * tokens either way and Graph subscriptions expire on their own regardless.
 */
export async function revokeOutlookSubscription(
  accessToken: string,
  subscriptionId: string,
): Promise<void> {
  try {
    await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (e) {
    console.warn("[Microsoft OAuth] Failed to revoke Graph subscription:", e);
  }
}

/**
 * Initiates a fully STANDALONE Microsoft Teams chat connection — its own
 * OAuth round-trip, its own token, saved as its own top-level
 * `integrations.teams` doc, separate from `integrations.outlook`.
 *
 * Deliberately NOT bundled into initiateOutlookConnection even though both
 * reuse the same Azure AD app registration (MICROSOFT_CLIENT_ID) — matches
 * the OneDrive precedent above: each Graph capability that needs its own
 * subscription lifecycle gets its own `integrations.*` doc, so connecting
 * (or disconnecting) one never silently affects the other, and a user can
 * have Teams without Outlook mail (e.g. Gmail for mail, Teams for work
 * chat). Teams chat-message Graph subscriptions also expire in ~60 minutes
 * (vs. mail's ~3 days), which needs its own fast renewal cron — reusing
 * Outlook's doc would mix two very different renewal cadences into one
 * record.
 *
 * Requests ChatMessage.Send (send into an existing chat) and Chat.Create
 * (create a new 1:1 chat for cold outreach to someone who hasn't messaged
 * first — POST /chats is idempotent, so this is also safe to call when a
 * chat already exists) alongside Chat.Read — the agent can both read and
 * reply to Teams chats, with human approval before any send (mirrors
 * Slack's read + chat-write scope set).
 */
export async function initiateTeamsConnection(): Promise<{
  success: boolean;
  email?: string;
  error?: string;
}> {
  const clientId = process.env.EXPO_PUBLIC_MICROSOFT_CLIENT_ID || "";
  if (!clientId) {
    return {
      success: false,
      error: "Teams connection is not configured (missing Microsoft client ID).",
    };
  }

  const redirectUrl = "app.synced.it://oauthredirect";

  try {
    const user = getAppUser();
    if (!user) {
      return {
        success: false,
        error: "User must be logged in to connect integrations.",
      };
    }

    const capCheck = await checkAccountCap("teams");
    if (!capCheck.ok) return { success: false, error: capCheck.error };

    const scopes = ["Chat.Read", "ChatMessage.Send", "Chat.Create", "User.Read", "offline_access"];

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = codeVerifier;

    const authUrl =
      `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
      `client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUrl)}` +
      `&response_type=code` +
      `&response_mode=query` +
      `&scope=${encodeURIComponent(scopes.join(" "))}` +
      `&code_challenge=${encodeURIComponent(codeChallenge)}` +
      `&code_challenge_method=plain`;

    console.log("[Teams OAuth] Initiating flow with authUrl:", authUrl);
    console.log("[Teams OAuth] Expecting redirect to:", redirectUrl);

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl, { preferEphemeralSession: true });

    if (result.type === "success" && result.url) {
      console.log("[Teams OAuth] Redirected back with URL:", result.url);
      const urlObj = Linking.parse(result.url);
      const code = urlObj.queryParams?.code;
      if (!code || typeof code !== "string") {
        return {
          success: false,
          error: "Authorization code not found or invalid in redirect URL.",
        };
      }

      console.log("[Teams OAuth] Exchanging code for tokens...");
      const response = await fetch(
        "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            redirect_uri: redirectUrl,
            grant_type: "authorization_code",
            code_verifier: codeVerifier,
            scope: scopes.join(" "),
          }).toString(),
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        console.error("[Teams OAuth] Token exchange failed:", errText);
        return { success: false, error: `Failed to exchange code: ${errText}` };
      }

      const tokens = await response.json();
      const accessToken = tokens.access_token;
      const refreshToken = tokens.refresh_token || "";
      const expiryDate = new Date(
        Date.now() + tokens.expires_in * 1000,
      ).toISOString();
      let email = "connected.user@teams.microsoft.com";
      let teamsUserId = "";

      console.log(
        "[Teams OAuth] Token exchange successful. Fetching user profile...",
      );
      try {
        const userRes = await fetch("https://graph.microsoft.com/v1.0/me", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (userRes.ok) {
          const userData = await userRes.json();
          email = userData.mail || userData.userPrincipalName || email;
          teamsUserId = userData.id || "";
        }
      } catch (err) {
        console.error("[Teams OAuth] Failed to fetch user profile:", err);
      }

      const grantedScopes = tokens.scope ? tokens.scope.split(" ") : scopes;

      // Chat.Read/ChatMessage.Send/Chat.Create are documented by Microsoft
      // as "Not supported" for personal Microsoft accounts (outlook.com/
      // hotmail.com/live.com) — Teams' chat data model in Graph simply
      // doesn't exist for a consumer MSA, only for work/school (Entra ID)
      // accounts. Microsoft doesn't error the OAuth flow for this — it
      // silently narrows the granted scope set to whatever the account DOES
      // support (see the "scope" field docs: "May not include all of the
      // scopes requested, if they weren't applicable to the user"), so
      // without this check the flow "succeeds" while writing an integration
      // that can never actually receive or send a single Teams message.
      // Fail loudly here instead of writing that broken state to Firestore.
      const hasAnyChatScope = grantedScopes.some((s: string) => s.toLowerCase().startsWith('chat.'));
      if (!hasAnyChatScope) {
        console.error('[Teams OAuth] Granted scopes are missing all Chat.* permissions — likely a personal Microsoft account, which Teams chat APIs do not support.', grantedScopes);
        return {
          success: false,
          error: 'Microsoft Teams requires a work or school (Microsoft 365) account — personal Microsoft accounts are not supported by Teams chat APIs.',
        };
      }

      const clientState = generateCodeVerifier() + generateCodeVerifier();
      let subscriptionId: string | undefined;
      let subscriptionExpiresAt: string | undefined;

      const notificationUrl = process.env.EXPO_PUBLIC_TEAMS_WEBHOOK_URL || "";
      if (notificationUrl) {
        try {
          // Chat-message resources cap at ~60 minutes (not mail's ~3 days) —
          // leave a 5-minute margin under that ceiling. Graph rejects
          // subscription creation beyond 1hr expiry without
          // lifecycleNotificationUrl, so it's included unconditionally here
          // rather than only for longer-lived subscriptions like Outlook's.
          subscriptionExpiresAt = new Date(Date.now() + 55 * 60 * 1000).toISOString();
          const subRes = await fetch(
            "https://graph.microsoft.com/v1.0/subscriptions",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                changeType: "created",
                notificationUrl,
                lifecycleNotificationUrl: notificationUrl,
                resource: "me/chats/getAllMessages",
                expirationDateTime: subscriptionExpiresAt,
                clientState,
              }),
            },
          );
          if (subRes.ok) {
            const subData = await subRes.json();
            subscriptionId = subData.id;
            console.log("[Teams OAuth] Graph subscription created:", subscriptionId);
          } else {
            const errText = await subRes.text();
            console.warn("[Teams OAuth] Graph subscription creation failed:", errText);
          }
        } catch (err) {
          console.warn("[Teams OAuth] Graph subscription creation error:", err);
        }
      } else {
        console.warn(
          "[Teams OAuth] EXPO_PUBLIC_TEAMS_WEBHOOK_URL not configured — skipping subscription creation. Inbound Teams messages will not be ingested until this is set and the account is reconnected.",
        );
      }

      // Keyed by teamsUserId, not email — Teams' email fallback is
      // frequently a generic placeholder string (see the `let email =
      // "connected.user@teams.microsoft.com"` default above), unreliable
      // as a dedup key. teamsUserId is the real stable Graph identity.
      const integration: OAuthAccount = {
        accountId: slugify(teamsUserId || email),
        isDefault: false,
        provider: "microsoft",
        email,
        accessToken,
        refreshToken,
        expiryDate,
        scopes: grantedScopes,
        status: "active",
        connectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        meta: {
          clientState,
          teamsUserId,
          ...(subscriptionId ? { subscriptionId } : {}),
          ...(subscriptionExpiresAt ? { subscriptionExpiresAt } : {}),
        },
      };

      console.log("[Teams OAuth] Saving integration details to Firestore...");
      await saveOAuthIntegration(user.uid, "teams", integration);

      return { success: true, email };
    }

    return { success: false, error: "Authentication was cancelled or failed." };
  } catch (e: any) {
    console.error("[Teams OAuth] Error:", e);
    return {
      success: false,
      error: e.message || "An error occurred during authentication.",
    };
  }
}

/**
 * Revokes the Graph chat-message subscription for a connected Teams account
 * — best-effort, mirrors revokeOutlookSubscription's reasoning exactly (a
 * failure here should never block the local disconnect).
 */
export async function revokeTeamsSubscription(
  accessToken: string,
  subscriptionId: string,
): Promise<void> {
  try {
    await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (e) {
    console.warn("[Teams OAuth] Failed to revoke Graph subscription:", e);
  }
}

/**
 * Initiates Slack DM connection.
 *
 * Unlike Gmail/Outlook (PKCE, token exchange happens right here on-device),
 * Slack's token exchange happens SERVER-SIDE, in the completeSlackOAuth
 * Cloud Function — see that function's doc comment in functions/src/index.ts
 * for the full "Prerequisites" checklist (Slack app creation, scopes,
 * redirect URL, Events Subscriptions setup) this depends on. Reasoning:
 * Slack's PKCE path forces a rotating-token model (12h access tokens, 30-day
 * refresh tokens that die entirely if unused for 30 days) — doing the
 * exchange server-side with the app's client secret instead gets Slack's
 * classic long-lived tokens, avoiding a real silent-disconnect failure mode
 * for a user who doesn't trigger a Slack action for a month.
 *
 * Flow: this function opens Slack's authorize URL with redirect_uri pointing
 * at the completeSlackOAuth Cloud Function (a pre-registered HTTPS URL, as
 * Slack's OAuth config requires — NOT the app's custom scheme directly).
 * That function exchanges the code, saves the integration, then 302s the
 * browser to "app.synced.it://oauthredirect?provider=slack&status=..." so
 * this openAuthSessionAsync call still resolves with a result the same way
 * Gmail/Outlook's flows do.
 */
export async function initiateSlackConnection(): Promise<ConnectionResult> {
  const clientId = process.env.EXPO_PUBLIC_SLACK_CLIENT_ID || "";
  const oauthCallbackUrl = process.env.EXPO_PUBLIC_SLACK_OAUTH_CALLBACK_URL || "";
  if (!clientId || !oauthCallbackUrl) {
    return {
      success: false,
      error: "Slack connection is not configured (missing Slack client ID or OAuth callback URL).",
    };
  }

  const redirectUrl = "app.synced.it://oauthredirect";

  // 1:1 DMs only — no mpim:* (group DM) scopes requested, matching this
  // integration's deliberately narrower scope than a full Slack workspace app.
  const userScopes = [
    "im:history",
    "im:read",
    "im:write",
    "chat:write",
    "files:read",
    "files:write",
    "users:read",
  ];

  try {
    const user = getAppUser();
    if (!user) {
      return {
        success: false,
        error: "User must be logged in to connect integrations.",
      };
    }

    // `state` binds the callback to this Firebase user — completeSlackOAuth
    // decodes it to know which user doc to save the integration under, since
    // (unlike the PKCE flows above) there's no on-device code_verifier to
    // correlate the callback back to this specific connect attempt.
    const state = encodeURIComponent(user.uid);

    const authUrl =
      `https://slack.com/oauth/v2/authorize?` +
      `client_id=${encodeURIComponent(clientId)}` +
      `&user_scope=${encodeURIComponent(userScopes.join(","))}` +
      `&redirect_uri=${encodeURIComponent(oauthCallbackUrl)}` +
      `&state=${state}`;

    console.log("[Slack OAuth] Initiating flow with authUrl:", authUrl);
    console.log("[Slack OAuth] Expecting redirect to:", redirectUrl);

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl, { preferEphemeralSession: true });

    if (result.type === "success" && result.url) {
      console.log("[Slack OAuth] Redirected back with URL:", result.url);
      const urlObj = Linking.parse(result.url);
      const status = urlObj.queryParams?.status;
      const email = urlObj.queryParams?.email;
      const teamName = urlObj.queryParams?.teamName;
      const displayName = urlObj.queryParams?.displayName;
      const message = urlObj.queryParams?.message;

      if (status === "success") {
        return {
          success: true,
          email: typeof email === "string" ? email : undefined,
          teamName: typeof teamName === "string" ? teamName : undefined,
          displayName: typeof displayName === "string" ? displayName : undefined,
        };
      }
      return {
        success: false,
        error: typeof message === "string" ? message : "Failed to connect Slack.",
      };
    }

    return { success: false, error: "Authentication was cancelled or failed." };
  } catch (e: any) {
    console.error("[Slack OAuth] Error:", e);
    return {
      success: false,
      error: e.message || "An error occurred during authentication.",
    };
  }
}

/**
 * Verifies a Slack account for chatbot/ (a SEPARATE, bot-token Slack app
 * powering the DM-based chat interface — see completeSlackBotOAuth's doc
 * comment in functions/src/index.ts for why this can't reuse the existing
 * per-user Slack integration/app). This flow's only job is proving "this
 * Slack user ID really belongs to this Firebase user" via a real OAuth
 * grant; chatbot/'s own bot token (a separate credential, never touched
 * here) is what actually reads/sends messages. Saved under
 * integrations.slackBot, independent of integrations.slack.
 */
export async function initiateSlackBotVerification(): Promise<ConnectionResult> {
  const clientId = process.env.EXPO_PUBLIC_SLACK_BOT_CLIENT_ID || "";
  const oauthCallbackUrl = process.env.EXPO_PUBLIC_SLACK_BOT_OAUTH_CALLBACK_URL || "";
  if (!clientId || !oauthCallbackUrl) {
    return {
      success: false,
      error: "Slack bot verification is not configured (missing Slack bot client ID or OAuth callback URL).",
    };
  }

  const redirectUrl = "app.synced.it://oauthredirect";

  // Identity-only — this app never sends/reads anything itself, so it only
  // needs enough scope for oauth.v2.access + users.info to resolve who
  // authorized.
  const userScopes = ["users:read"];

  try {
    const user = getAppUser();
    if (!user) {
      return {
        success: false,
        error: "User must be logged in to connect integrations.",
      };
    }

    const state = encodeURIComponent(user.uid);

    const authUrl =
      `https://slack.com/oauth/v2/authorize?` +
      `client_id=${encodeURIComponent(clientId)}` +
      `&user_scope=${encodeURIComponent(userScopes.join(","))}` +
      `&redirect_uri=${encodeURIComponent(oauthCallbackUrl)}` +
      `&state=${state}`;

    console.log("[Slack Bot OAuth] Initiating flow with authUrl:", authUrl);
    console.log("[Slack Bot OAuth] Expecting redirect to:", redirectUrl);

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl, { preferEphemeralSession: true });

    if (result.type === "success" && result.url) {
      console.log("[Slack Bot OAuth] Redirected back with URL:", result.url);
      const urlObj = Linking.parse(result.url);
      const status = urlObj.queryParams?.status;
      const teamName = urlObj.queryParams?.teamName;
      const displayName = urlObj.queryParams?.displayName;
      const message = urlObj.queryParams?.message;

      if (status === "success") {
        return {
          success: true,
          teamName: typeof teamName === "string" ? teamName : undefined,
          displayName: typeof displayName === "string" ? displayName : undefined,
        };
      }
      return {
        success: false,
        error: typeof message === "string" ? message : "Failed to verify Slack account.",
      };
    }

    return { success: false, error: "Authentication was cancelled or failed." };
  } catch (e: any) {
    console.error("[Slack Bot OAuth] Error:", e);
    return {
      success: false,
      error: e.message || "An error occurred during authentication.",
    };
  }
}

/**
 * Initiates a fully STANDALONE OneDrive connection — its own OAuth
 * round-trip, its own token, saved as its own top-level
 * `integrations.onedrive` doc (see saveOAuthIntegration). No dependency on
 * Outlook being connected, and no requirement that it be the same
 * Microsoft account. Requests User.Read (not just Files.Read) since there's
 * no existing Outlook integration to borrow an email address from.
 */
export async function initiateOneDriveConnection(): Promise<ConnectionResult> {
  const clientId = process.env.EXPO_PUBLIC_MICROSOFT_CLIENT_ID || "";
  if (!clientId) {
    return {
      success: false,
      error: "OneDrive connection is not configured (missing Microsoft client ID).",
    };
  }

  const redirectUrl = "app.synced.it://oauthredirect";

  try {
    const user = getAppUser();
    if (!user) {
      return {
        success: false,
        error: "User must be logged in to connect integrations.",
      };
    }

    const capCheck = await checkAccountCap("onedrive");
    if (!capCheck.ok) return { success: false, error: capCheck.error };

    const scopes = ["Files.Read", "User.Read", "offline_access"];

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = codeVerifier;

    const authUrl =
      `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
      `client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUrl)}` +
      `&response_type=code` +
      `&response_mode=query` +
      `&scope=${encodeURIComponent(scopes.join(" "))}` +
      `&code_challenge=${encodeURIComponent(codeChallenge)}` +
      `&code_challenge_method=plain`;

    console.log("[Microsoft OAuth] Initiating standalone OneDrive flow with authUrl:", authUrl);

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl, { preferEphemeralSession: true });

    if (result.type === "success" && result.url) {
      const urlObj = Linking.parse(result.url);
      const code = urlObj.queryParams?.code;
      if (!code || typeof code !== "string") {
        return {
          success: false,
          error: "Authorization code not found or invalid in redirect URL.",
        };
      }

      const response = await fetch(
        "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            redirect_uri: redirectUrl,
            grant_type: "authorization_code",
            code_verifier: codeVerifier,
            scope: scopes.join(" "),
          }).toString(),
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        console.error("[Microsoft OAuth] OneDrive token exchange failed:", errText);
        return { success: false, error: `Failed to exchange code: ${errText}` };
      }

      const tokens = await response.json();
      const accessToken = tokens.access_token;
      const refreshToken = tokens.refresh_token || "";
      const expiryDate = new Date(
        Date.now() + tokens.expires_in * 1000,
      ).toISOString();
      const grantedScopes = tokens.scope ? tokens.scope.split(" ") : scopes;

      let email = "connected.user@outlook.com";
      try {
        const userRes = await fetch("https://graph.microsoft.com/v1.0/me", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (userRes.ok) {
          const userData = await userRes.json();
          email = userData.mail || userData.userPrincipalName || email;
        }
      } catch (err) {
        console.error("[Microsoft OAuth] Failed to fetch OneDrive account email:", err);
      }

      const integration: OAuthAccount = {
        accountId: slugify(email),
        isDefault: false,
        provider: "microsoft",
        email,
        accessToken,
        refreshToken,
        expiryDate,
        scopes: grantedScopes,
        status: "active",
        connectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await saveOAuthIntegration(user.uid, "onedrive", integration);

      return { success: true, email };
    }

    return { success: false, error: "Authentication was cancelled or failed." };
  } catch (e: any) {
    console.error("[Microsoft OAuth] OneDrive connection error:", e);
    return {
      success: false,
      error: e.message || "An error occurred during authentication.",
    };
  }
}

/**
 * Saves a simulated Gmail connection for development or preview.
 */
export async function saveSimulatedGmailConnection(
  email: string,
): Promise<ConnectionResult> {
  try {
    const user = getAppUser();
    if (!user) {
      return {
        success: false,
        error: "User must be logged in to connect integrations.",
      };
    }

    const integration: OAuthAccount = {
      accountId: slugify(email),
      isDefault: false,
      provider: "google",
      email,
      accessToken: "simulated_access_token",
      refreshToken: "simulated_refresh_token",
      expiryDate: new Date(Date.now() + 3600 * 1000).toISOString(),
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      status: "active",
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    console.log(
      "[Google OAuth] Saving simulated integration details to Firestore...",
    );
    await saveOAuthIntegration(user.uid, "gmail", integration);

    return { success: true, email };
  } catch (e: any) {
    console.error("[Google OAuth] Simulated connection error:", e);
    return {
      success: false,
      error: e.message || "An error occurred during simulated connection.",
    };
  }
}
