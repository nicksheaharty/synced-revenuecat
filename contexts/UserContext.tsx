import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  doc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";
import { db, subscribeToAuth, signOutUser } from "../services/firebase";
import { configurePurchases, resetPurchases } from "../services/purchases";
import {
  UserDocument,
  Profile,
  GroupThread,
  Task,
  Deliverable,
  Message,
  clearOnboarding,
} from "../services/storage";
import { registerForPushNotificationsAsync, unregisterPushNotificationsAsync } from "../services/notifications";

// Same growing-limit pagination shape already used by
// app/deliverables.tsx's own independent listener — profiles/tasks
// mirror that precedent rather than inventing a new pattern.
const PAGE_SIZE = 30;

// Generous enough to comfortably cover "the latest message" for every one
// of PAGE_SIZE(30) visible conversations even with several messages each
// clustered close together in time, without holding the account's entire
// message history in memory — see the messages listener's own doc comment
// for why this bound is safe.
const MESSAGES_LIMIT = 300;

// Weekly Action Plan caps — mirrored on the backend in
// functions/src/pipeline.ts's writeTriageTasks, which is the actual
// enforcement point. Keep these two in sync; they only exist here for
// optimistic UI (settings usage card, paywall copy) before the real
// server-computed count arrives.
const FREE_WEEKLY_ACTION_PLAN_LIMIT = 20;
const PRO_WEEKLY_ACTION_PLAN_LIMIT = 100;

// Same reasoning as MESSAGES_LIMIT — see the deliverables listener's own
// doc comment for why every OTHER real need for an old deliverable now goes
// through a targeted on-demand fetch instead of this array.
const DELIVERABLES_LIMIT = 150;

interface UserContextValue {
  user: {
    uid: string;
    email: string | null;
    phoneNumber: string | null;
  } | null;
  userDoc: UserDocument | null;
  // Paginated — most-recent-first, capped at the current page size. NOT
  // guaranteed to contain every profile/task the user has; do not use these
  // for counts, cross-profile status filters, or "mark all X as seen"
  // logic — see openHumanTaskCount / pendingHitlTasks / unseenHumanTasks
  // below, which are separate unbounded queries for exactly that purpose.
  profiles: Profile[];
  // Multi-person conversations — kept separate from `profiles` (Profile is
  // now always exactly one person). A conversation "row" in the UI is
  // either a Profile or a GroupThread — see MessageCard.tsx's
  // ConversationRow-shaped usage.
  groupThreads: GroupThread[];
  tasks: Task[];
  hasMoreProfiles: boolean;
  hasMoreGroupThreads: boolean;
  hasMoreTasks: boolean;
  loadMoreProfiles: () => void;
  loadMoreGroupThreads: () => void;
  loadMoreTasks: () => void;
  // Unbounded, purpose-built queries — each reflects the TRUE full-account
  // state for its specific condition, independent of the paginated
  // `tasks` page above.
  openHumanTaskCount: number;
  pendingHitlTasks: Task[];
  unseenHumanTasks: Task[];
  // EVERY task assigned to the human (open AND completed) — unbounded,
  // unlike the paginated `tasks` page above. app/(main)/tasks.tsx (the "My
  // Tasks" screen) needs this specifically: filtering the paginated `tasks`
  // array down to assignee === "human" silently loses older human tasks
  // once a user has enough recent AGENT tasks to push them off the page —
  // a real bug (human tasks appearing to "not all load"), not a rendering
  // glitch. Deliberately a separate query from openHumanTaskCount/
  // unseenHumanTasks above (which exclude completed tasks) — the My Tasks
  // screen shows a collapsible "N Tasks Completed" section, so it needs
  // completed human tasks too.
  allHumanTasks: Task[];
  // Agent tasks (assignee === "agent") created since local midnight today —
  // resets automatically at midnight because the query bound itself is
  // recomputed daily (see the effect below), not because anything decrements it.
  agentTasksStartedToday: number;
  // Bounded to the most recent DELIVERABLES_LIMIT across the whole account —
  // NOT a complete history. Correct for home.tsx's recent-conversation task
  // preview; do not use this to look up deliverables for a possibly-old
  // task/profile (see getDeliverablesForTaskIds/getDeliverablesForProfile in
  // services/storage.ts instead — used by app/(main)/tasks.tsx's My Tasks
  // completed-tasks section, components/useHitlAnswerState.ts's draft
  // attachment picker, and app/conversation/[profileId].tsx's file history,
  // all of which genuinely need to resolve an arbitrarily old deliverable).
  deliverables: Deliverable[];
  // Bounded to the most recent MESSAGES_LIMIT across the whole account (see
  // the messages listener's own doc comment) — NOT a complete history.
  // Correct for "latest message per conversation" (MessageCard.tsx/
  // home.tsx); do not use this to look up one specific, possibly-old
  // message by id (see getMessageById in services/storage.ts instead — used
  // by app/(main)/answer.tsx for exactly that case).
  messages: Message[];
  loading: boolean;
  // True until the profiles listener's FIRST snapshot has arrived — see the
  // effect below for why this can't just be derived from `loading` (which
  // only tracks the small users/{uid} doc and resolves well before the
  // profiles query does). home.tsx gates its skeleton on this too, so an
  // empty `profiles` array during that initial window reads as "still
  // loading" instead of "genuinely no conversations yet".
  profilesLoading: boolean;
  // Derived from userDoc.subscription — "pro" only when RevenueCat's
  // webhook (functions/src/index.ts's revenueCatWebhook) has confirmed an
  // active entitlement. Absent subscription doc == "free", which also
  // covers every user who existed before billing shipped.
  plan: "free" | "pro";
  // This week's Action Plan count and cap, mirrored from
  // users/{uid}/usage/currentWeek — the SAME counter
  // functions/src/pipeline.ts's writeTriageTasks enforces against
  // server-side. Client-side gating (settings usage card, paywall triggers)
  // reads this; it is never the source of truth for enforcement.
  weeklyActionPlanCount: number;
  weeklyActionPlanLimit: number;
  weeklyLimitReached: boolean;
  signOut: () => Promise<void>;
}

const UserContext = createContext<UserContextValue>({
  user: null,
  userDoc: null,
  profiles: [],
  groupThreads: [],
  tasks: [],
  hasMoreProfiles: false,
  hasMoreGroupThreads: false,
  hasMoreTasks: false,
  loadMoreProfiles: () => {},
  loadMoreGroupThreads: () => {},
  loadMoreTasks: () => {},
  openHumanTaskCount: 0,
  pendingHitlTasks: [],
  unseenHumanTasks: [],
  allHumanTasks: [],
  agentTasksStartedToday: 0,
  deliverables: [],
  messages: [],
  loading: true,
  profilesLoading: true,
  plan: "free",
  weeklyActionPlanCount: 0,
  weeklyActionPlanLimit: FREE_WEEKLY_ACTION_PLAN_LIMIT,
  weeklyLimitReached: false,
  signOut: async () => {},
});

function mapTaskDoc(id: string, data: any): Task {
  return {
    id,
    profileId: data.profileId,
    userId: data.userId,
    threadId: data.threadId,
    title: data.title,
    assignee: data.assignee,
    status: data.status,
    activityIndicator: data.activityIndicator,
    implementationPlan: data.implementationPlan || [],
    requiredDeliverables: data.requiredDeliverables || [],
    humanInputRequest: data.humanInputRequest,
    humanInputHistory: data.humanInputHistory,
    dueDate:
      data.dueDate instanceof Timestamp
        ? data.dueDate.toDate().toISOString()
        : data.dueDate,
    dueDatePrecision: data.dueDatePrecision,
    createdAt:
      data.createdAt instanceof Timestamp
        ? data.createdAt.toDate().toISOString()
        : data.createdAt,
    updatedAt:
      data.updatedAt instanceof Timestamp
        ? data.updatedAt.toDate().toISOString()
        : data.updatedAt,
    seen: data.seen,
  };
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserContextValue["user"]>(null);
  const [userDoc, setUserDoc] = useState<UserDocument | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [groupThreads, setGroupThreads] = useState<GroupThread[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [profilePageSize, setProfilePageSize] = useState(PAGE_SIZE);
  const [groupThreadPageSize, setGroupThreadPageSize] = useState(PAGE_SIZE);
  const [taskPageSize, setTaskPageSize] = useState(PAGE_SIZE);
  const [hasMoreProfiles, setHasMoreProfiles] = useState(true);
  const [hasMoreGroupThreads, setHasMoreGroupThreads] = useState(true);
  const [hasMoreTasks, setHasMoreTasks] = useState(true);
  const [openHumanTaskCount, setOpenHumanTaskCount] = useState(0);
  const [pendingHitlTasks, setPendingHitlTasks] = useState<Task[]>([]);
  const [unseenHumanTasks, setUnseenHumanTasks] = useState<Task[]>([]);
  const [allHumanTasks, setAllHumanTasks] = useState<Task[]>([]);
  const [agentTasksStartedToday, setAgentTasksStartedToday] = useState(0);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [profilesLoading, setProfilesLoading] = useState(true);

  const loadMoreProfiles = useCallback(() => {
    setProfilePageSize((prev) => prev + PAGE_SIZE);
  }, []);
  const loadMoreGroupThreads = useCallback(() => {
    setGroupThreadPageSize((prev) => prev + PAGE_SIZE);
  }, []);
  const loadMoreTasks = useCallback(() => {
    setTaskPageSize((prev) => prev + PAGE_SIZE);
  }, []);

  useEffect(() => {
    let unsubUser: (() => void) | null = null;
    let unsubDeliverables: (() => void) | null = null;
    let unsubMessages: (() => void) | null = null;

    const unsubAuth = subscribeToAuth((authUser: any) => {
      // Clean up previous listeners
      if (unsubUser) {
        unsubUser();
        unsubUser = null;
      }
      if (unsubDeliverables) {
        unsubDeliverables();
        unsubDeliverables = null;
      }
      if (unsubMessages) {
        unsubMessages();
        unsubMessages = null;
      }

      console.log(
        "[User Context] Auth State Resolved:",
        authUser ? `UID: ${authUser.uid}` : "Logged Out",
      );

      if (!authUser) {
        setUser(null);
        setUserDoc(null);
        setDeliverables([]);
        setMessages([]);
        setLoading(false);
        return;
      }

      setUser({
        uid: authUser.uid,
        email: authUser.email || null,
        phoneNumber: authUser.phoneNumber || null,
      });

      configurePurchases(authUser.uid);

      // Fire-and-forget — never blocks auth resolution on a permission
      // prompt or a slow push-token fetch (see the function's own
      // never-throws guarantee). Runs once per login; safe to re-run on
      // every auth-state change since both the permission check and
      // addPushToken's arrayUnion are idempotent for an unchanged token.
      void registerForPushNotificationsAsync(authUser.uid);

      if (!db) {
        setLoading(false);
        return;
      }

      // 1. Listen to user document in Firestore
      unsubUser = onSnapshot(
        doc(db, "users", authUser.uid),
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            const integrations = data.integrations || {};
            Object.keys(data).forEach((key) => {
              if (key.startsWith("integrations.")) {
                const integrationId = key.substring("integrations.".length);
                integrations[integrationId] = data[key];
              }
            });
            setUserDoc({
              uid: snap.id,
              email: data.email,
              phoneNumber: data.phoneNumber,
              fullName: data.fullName,
              createdAt:
                data.createdAt instanceof Timestamp
                  ? data.createdAt.toDate().toISOString()
                  : data.createdAt,
              updatedAt:
                data.updatedAt instanceof Timestamp
                  ? data.updatedAt.toDate().toISOString()
                  : data.updatedAt,
              integrations,
              brandSettings: data.brandSettings,
              sandboxMode: data.sandboxMode,
              emailFilterMode: data.emailFilterMode,
              subscription: data.subscription,
            } as UserDocument);
          } else {
            setUserDoc(null);
          }
          setLoading(false);
        },
        (err) => {
          console.error("[User Context] User doc subscription error:", err);
          setLoading(false);
        },
      );

      // Profiles and tasks are paginated (see the separate effects below,
      // keyed on `user` + page size) — not part of this auth-driven effect.

      // 4. Listen to deliverables — bounded to the most recent
      // DELIVERABLES_LIMIT, same reasoning as the messages listener below.
      // Every consumer that genuinely needs an OLD deliverable (My Tasks'
      // completed-tasks section, a HITL draft's attachment picker, a
      // conversation's own file history) now fetches it on demand instead
      // of relying on this array — see getDeliverablesForTaskIds/
      // getDeliverablesForProfile in services/storage.ts. This array's only
      // remaining consumer (home.tsx's task-preview file chips on recent/
      // visible conversation cards) only ever needs recent activity.
      const qDeliverables = query(
        collection(db, "deliverables"),
        where("userId", "==", authUser.uid),
        orderBy("createdAt", "desc"),
        limit(DELIVERABLES_LIMIT),
      );
      unsubDeliverables = onSnapshot(qDeliverables, (snap) => {
        const list: Deliverable[] = [];
        snap.forEach((d) => {
          const data = d.data();
          list.push({
            id: d.id,
            userId: data.userId,
            taskId: data.taskId,
            profileId: data.profileId,
            name: data.name,
            type: data.type,
            mimeType: data.mimeType,
            url: data.url,
            createdAt:
              data.createdAt instanceof Timestamp
                ? data.createdAt.toDate().toISOString()
                : data.createdAt,
            updatedAt:
              data.updatedAt instanceof Timestamp
                ? data.updatedAt.toDate().toISOString()
                : data.updatedAt,
          });
        });
        setDeliverables(list);
      });

      // 5. Listen to messages — bounded to the most recent MESSAGES_LIMIT
      // across the WHOLE account (not per-conversation), ordered by
      // createdAt desc. CONFIRMED safe to bound (unlike deliverables, which
      // stays unbounded — see its own comment below): this array's only
      // real consumers are MessageCard.tsx/home.tsx's "latest message per
      // conversation" preview, which only ever needs recent activity. The
      // one place that genuinely needed an arbitrarily-old specific message
      // (app/(main)/answer.tsx's HITL triggering-message lookup) now fetches
      // that one message on demand by id (getMessageById in
      // services/storage.ts) instead of depending on this array containing
      // it. Previously fully unbounded — pulled and held the account's
      // ENTIRE message history in memory, live, forever; the single biggest
      // contributor to slow cold-start load and to every MessageCard
      // redoing a full-array filter+sort on every unrelated message update
      // (see MessageCard.tsx's profileMessages memo).
      const qMessages = query(
        collection(db, "messages"),
        where("userId", "==", authUser.uid),
        orderBy("createdAt", "desc"),
        limit(MESSAGES_LIMIT),
      );
      unsubMessages = onSnapshot(qMessages, (snap) => {
        const list: Message[] = [];
        snap.forEach((d) => {
          const data = d.data();
          list.push({
            id: d.id,
            profileId: data.profileId,
            userId: data.userId,
            direction: data.direction,
            text: data.text,
            timestamp: data.timestamp,
            platformMessageId: data.platformMessageId,
            subject: data.subject,
            taskId: data.taskId,
            attachments: data.attachments,
            kind: data.kind,
            calendarEvent: data.calendarEvent,
            createdAt:
              data.createdAt instanceof Timestamp
                ? data.createdAt.toDate().toISOString()
                : data.createdAt,
          });
        });
        setMessages(list);
      });
    });

    return () => {
      unsubAuth();
      if (unsubUser) unsubUser();
      if (unsubDeliverables) unsubDeliverables();
      if (unsubMessages) unsubMessages();
    };
  }, []);

  // Paginated profiles — most-recent-first, capped at profilePageSize.
  // Separate effect (rather than nested in the auth effect above) because
  // it needs to re-subscribe whenever profilePageSize grows, matching
  // deliverables.tsx's existing pagination pattern.
  //
  // Page by conversation activity, not profile creation. A message from an
  // older contact updates the profile's updatedAt and must bring that thread
  // back into the first page; ordering by createdAt left active old threads
  // permanently outside the 30-profile subscription even though their new
  // Message and Task docs were arriving correctly.
  //
  // Firestore's orderBy("updatedAt", ...) silently EXCLUDES any document
  // missing that field. A second, unordered where("userId", ...) listener
  // catches exactly those legacy profiles and merges them in.
  useEffect(() => {
    if (!user || !db) {
      setProfiles([]);
      setHasMoreProfiles(true);
      // No auth session yet means there's nothing to wait on — a logged-out
      // state should show the real empty/login state, not a stuck skeleton.
      setProfilesLoading(false);
      return;
    }
    setProfilesLoading(true);
    let orderedList: Profile[] = [];
    let legacyList: Profile[] = [];
    const mergeAndSet = () => {
      const seen = new Set(orderedList.map((p) => p.id));
      const merged = [...orderedList, ...legacyList.filter((p) => !seen.has(p.id))];
      setProfiles(merged);
    };

    const mapProfileDoc = (id: string, data: any): Profile => ({
      id,
      userId: data.userId,
      name: data.name,
      senderInitial: data.senderInitial,
      avatarUri: data.avatarUri,
      customAvatarUri: data.customAvatarUri,
      source: data.source,
      platformIdentifier: data.platformIdentifier,
      teamsChatId: data.teamsChatId,
      latestMessageId: data.latestMessageId,
      analyzed: data.analyzed,
      createdAt:
        data.createdAt instanceof Timestamp
          ? data.createdAt.toDate().toISOString()
          : data.createdAt,
      updatedAt:
        data.updatedAt instanceof Timestamp
          ? data.updatedAt.toDate().toISOString()
          : data.updatedAt,
    });

    const q = query(
      collection(db, "profiles"),
      where("userId", "==", user.uid),
      orderBy("updatedAt", "desc"),
      limit(profilePageSize),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        orderedList = [];
        snap.forEach((d) => orderedList.push(mapProfileDoc(d.id, d.data())));
        mergeAndSet();
        setHasMoreProfiles(snap.size >= profilePageSize);
        setProfilesLoading(false);
      },
      (err) => {
        console.error("[User Context] Profiles subscription error:", err);
        setProfilesLoading(false);
      },
    );

    const qLegacy = query(
      collection(db, "profiles"),
      where("userId", "==", user.uid),
    );
    const unsubLegacy = onSnapshot(
      qLegacy,
      (snap) => {
        legacyList = [];
        snap.forEach((d) => {
          if (d.data().updatedAt == null) legacyList.push(mapProfileDoc(d.id, d.data()));
        });
        mergeAndSet();
      },
      (err) => {
        console.error("[User Context] Legacy profiles subscription error:", err);
      },
    );

    return () => {
      unsub();
      unsubLegacy();
    };
  }, [user, profilePageSize]);

  // Paginated group threads — mirrors the profiles effect above exactly
  // (same growing-page-size pattern, same ordered+legacy dual-listener
  // shape), just against the separate groupThreads collection. See
  // GroupThread in services/storage.ts for why this is a distinct entity
  // from Profile (Profile is now always exactly one person; a GroupThread
  // references its members' Profile ids rather than embedding them).
  useEffect(() => {
    if (!user || !db) {
      setGroupThreads([]);
      setHasMoreGroupThreads(true);
      return;
    }
    let orderedList: GroupThread[] = [];
    let legacyList: GroupThread[] = [];
    const mergeAndSet = () => {
      const seen = new Set(orderedList.map((g) => g.id));
      const merged = [...orderedList, ...legacyList.filter((g) => !seen.has(g.id))];
      setGroupThreads(merged);
    };

    const mapGroupThreadDoc = (id: string, data: any): GroupThread => ({
      id,
      userId: data.userId,
      source: data.source,
      platformThreadKey: data.platformThreadKey,
      memberProfileIds: data.memberProfileIds || [],
      name: data.name,
      teamsChatId: data.teamsChatId,
      latestMessageId: data.latestMessageId,
      analyzed: data.analyzed,
      createdAt:
        data.createdAt instanceof Timestamp
          ? data.createdAt.toDate().toISOString()
          : data.createdAt,
      updatedAt:
        data.updatedAt instanceof Timestamp
          ? data.updatedAt.toDate().toISOString()
          : data.updatedAt,
    });

    const q = query(
      collection(db, "groupThreads"),
      where("userId", "==", user.uid),
      orderBy("updatedAt", "desc"),
      limit(groupThreadPageSize),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        orderedList = [];
        snap.forEach((d) => orderedList.push(mapGroupThreadDoc(d.id, d.data())));
        mergeAndSet();
        setHasMoreGroupThreads(snap.size >= groupThreadPageSize);
      },
      (err) => {
        console.error("[User Context] Group threads subscription error:", err);
      },
    );

    const qLegacy = query(
      collection(db, "groupThreads"),
      where("userId", "==", user.uid),
    );
    const unsubLegacy = onSnapshot(
      qLegacy,
      (snap) => {
        legacyList = [];
        snap.forEach((d) => {
          if (d.data().updatedAt == null) legacyList.push(mapGroupThreadDoc(d.id, d.data()));
        });
        mergeAndSet();
      },
      (err) => {
        console.error("[User Context] Legacy group threads subscription error:", err);
      },
    );

    return () => {
      unsub();
      unsubLegacy();
    };
  }, [user, groupThreadPageSize]);

  // Paginated tasks — most-recent-first, capped at taskPageSize. Same
  // caveat as profiles: NOT the full task list, so anything needing a true
  // account-wide count or status filter uses one of the unbounded queries
  // below instead (openHumanTaskCount, pendingHitlTasks, unseenHumanTasks).
  //
  // Same missing-createdAt gotcha as the profiles query above: orderBy
  // silently drops any task doc without that field, so a second unordered
  // listener catches legacy tasks and merges them in — otherwise tasks
  // created before createdAt was reliably set just disappear.
  useEffect(() => {
    if (!user || !db) {
      setTasks([]);
      setHasMoreTasks(true);
      return;
    }
    let orderedList: Task[] = [];
    let legacyList: Task[] = [];
    const mergeAndSet = () => {
      const seen = new Set(orderedList.map((t) => t.id));
      const merged = [...orderedList, ...legacyList.filter((t) => !seen.has(t.id))];
      setTasks(merged);
    };

    const q = query(
      collection(db, "tasks"),
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc"),
      limit(taskPageSize),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        orderedList = [];
        snap.forEach((d) => orderedList.push(mapTaskDoc(d.id, d.data())));
        mergeAndSet();
        setHasMoreTasks(snap.size >= taskPageSize);
      },
      (err) => {
        console.error("[User Context] Tasks subscription error:", err);
      },
    );

    const qLegacy = query(
      collection(db, "tasks"),
      where("userId", "==", user.uid),
    );
    const unsubLegacy = onSnapshot(
      qLegacy,
      (snap) => {
        legacyList = [];
        snap.forEach((d) => {
          if (d.data().createdAt == null) legacyList.push(mapTaskDoc(d.id, d.data()));
        });
        mergeAndSet();
      },
      (err) => {
        console.error("[User Context] Legacy tasks subscription error:", err);
      },
    );

    return () => {
      unsub();
      unsubLegacy();
    };
  }, [user, taskPageSize]);

  // Unbounded — every open task assigned to the human, regardless of
  // pagination. Feeds BOTH the tasks-tab badge count (openHumanTaskCount)
  // and "mark all unseen as seen" (unseenHumanTasks derives from the same
  // result set) — a paginated `tasks` page would silently undercount the
  // badge and leave older unseen tasks stuck forever, so this reads the
  // full set independently. Cheap in practice: this is a bounded
  // "currently open" set, not the whole task history.
  useEffect(() => {
    if (!user || !db) {
      setOpenHumanTaskCount(0);
      setUnseenHumanTasks([]);
      return;
    }
    const q = query(
      collection(db, "tasks"),
      where("userId", "==", user.uid),
      where("assignee", "==", "human"),
      // Triage can resolve a task via status: "inactive" (not just
      // "completed") — see writeTriageTasks's markInactive handling in
      // functions/src/pipeline.ts — so both need excluding here, or a
      // triage-resolved task keeps inflating the open-task badge forever.
      where("status", "not-in", ["completed", "inactive"]),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Task[] = [];
        snap.forEach((d) => list.push(mapTaskDoc(d.id, d.data())));
        setOpenHumanTaskCount(list.length);
        setUnseenHumanTasks(list.filter((t) => t.seen !== true));
      },
      (err) => {
        // FAILED_PRECONDITION here means Firestore needs a composite index
        // for (userId ==, assignee ==, status not-in) on `tasks` — the
        // error's own message includes a Firebase Console link that
        // auto-creates the exact index needed; open it and the query will
        // start working within a minute or two, no code change required.
        console.error("[User Context] Open human tasks subscription error (may need a composite index — see error message for a Console link):", err);
      },
    );
    return () => unsub();
  }, [user]);

  // Unbounded — EVERY task assigned to the human, open AND completed. See
  // this field's own doc comment on UserContextValue for the real bug this
  // fixes: app/(main)/tasks.tsx used to filter the PAGINATED `tasks` array
  // down to assignee === "human", which silently dropped older human tasks
  // once enough recent agent tasks filled the page — the "My Tasks list
  // doesn't load everything" symptom. Deliberately separate from
  // openHumanTaskCount's query above (which excludes completed tasks via
  // status !=) since My Tasks needs completed ones too, for its
  // collapsible "N Tasks Completed" section.
  useEffect(() => {
    if (!user || !db) {
      setAllHumanTasks([]);
      return;
    }
    const q = query(
      collection(db, "tasks"),
      where("userId", "==", user.uid),
      where("assignee", "==", "human"),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Task[] = [];
        snap.forEach((d) => list.push(mapTaskDoc(d.id, d.data())));
        setAllHumanTasks(list);
      },
      (err) => {
        console.error("[User Context] All human tasks subscription error:", err);
      },
    );
    return () => unsub();
  }, [user]);

  // Unbounded — every task currently awaiting human input, across every
  // profile/conversation, regardless of pagination. Lightning mode's whole
  // purpose is surfacing ALL of these; a paginated `tasks` page would
  // silently miss older pending HITL pauses.
  useEffect(() => {
    if (!user || !db) {
      setPendingHitlTasks([]);
      return;
    }
    const q = query(
      collection(db, "tasks"),
      where("userId", "==", user.uid),
      where("status", "==", "awaiting_human_input"),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Task[] = [];
        snap.forEach((d) => list.push(mapTaskDoc(d.id, d.data())));
        setPendingHitlTasks(list);
      },
      (err) => {
        console.error("[User Context] Pending HITL tasks subscription error:", err);
      },
    );
    return () => unsub();
  }, [user]);

  // Unbounded within today's window — every agent task (assignee === "agent")
  // created since local midnight. Re-subscribes at each local midnight
  // (via the `dayKey` dependency below) so a session left open overnight
  // rolls the count over to 0 for the new day instead of silently keeping
  // yesterday's window forever.
  const [dayKey, setDayKey] = useState(() => new Date().toDateString());
  useEffect(() => {
    const msUntilMidnight = new Date(new Date().toDateString()).getTime() + 24 * 60 * 60 * 1000 - Date.now() + 1000;
    const timer = setTimeout(() => setDayKey(new Date().toDateString()), msUntilMidnight);
    return () => clearTimeout(timer);
  }, [dayKey]);

  useEffect(() => {
    if (!user || !db) {
      setAgentTasksStartedToday(0);
      return;
    }
    const startOfToday = Timestamp.fromDate(new Date(new Date().toDateString()));
    const q = query(
      collection(db, "tasks"),
      where("userId", "==", user.uid),
      where("assignee", "==", "agent"),
      where("createdAt", ">=", startOfToday),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setAgentTasksStartedToday(snap.size);
      },
      (err) => {
        // FAILED_PRECONDITION here means Firestore needs a composite index
        // for (userId ==, assignee ==, createdAt >=) on `tasks` — the
        // error's own message includes a Firebase Console link that
        // auto-creates the exact index needed.
        console.error("[User Context] Agent tasks started today subscription error (may need a composite index — see error message for a Console link):", err);
      },
    );
    return () => unsub();
  }, [user, dayKey]);

  // Single-doc listener (not a live query like agentTasksStartedToday above)
  // — functions/src/pipeline.ts's writeTriageTasks maintains this exact
  // counter transactionally alongside every Action Plan it creates, so
  // reading it here is both cheap and always consistent with what the
  // backend just enforced. Resets to 0 client-side once the doc's own
  // weekStart falls behind the current week, mirroring the server's reset
  // check — real enforcement still happens server-side regardless.
  const [weeklyActionPlanCount, setWeeklyActionPlanCount] = useState(0);
  useEffect(() => {
    if (!user || !db) {
      setWeeklyActionPlanCount(0);
      return;
    }
    const unsub = onSnapshot(
      doc(db, "users", user.uid, "usage", "currentWeek"),
      (snap) => {
        if (!snap.exists()) {
          setWeeklyActionPlanCount(0);
          return;
        }
        const data = snap.data();
        const weekStart =
          data.weekStart instanceof Timestamp
            ? data.weekStart.toDate()
            : new Date(data.weekStart);
        const dayOfWeek = new Date().getUTCDay();
        const currentWeekStart = new Date();
        currentWeekStart.setUTCHours(0, 0, 0, 0);
        currentWeekStart.setUTCDate(
          currentWeekStart.getUTCDate() - ((dayOfWeek + 6) % 7),
        );
        setWeeklyActionPlanCount(
          weekStart < currentWeekStart ? 0 : data.actionPlansCreated || 0,
        );
      },
      (err) => {
        console.error("[User Context] Weekly usage subscription error:", err);
      },
    );
    return () => unsub();
  }, [user]);

  const plan: "free" | "pro" =
    userDoc?.subscription?.plan === "pro" &&
    userDoc.subscription.entitlementActive
      ? "pro"
      : "free";
  const weeklyActionPlanLimit =
    plan === "pro" ? PRO_WEEKLY_ACTION_PLAN_LIMIT : FREE_WEEKLY_ACTION_PLAN_LIMIT;
  const weeklyLimitReached = weeklyActionPlanCount >= weeklyActionPlanLimit;

  const handleSignOut = async () => {
    if (user?.uid) {
      await unregisterPushNotificationsAsync(user.uid);
    }
    resetPurchases();
    await signOutUser();
    await clearOnboarding();
  };

  return (
    <UserContext.Provider
      value={{
        user,
        userDoc,
        profiles,
        groupThreads,
        tasks,
        hasMoreProfiles,
        hasMoreGroupThreads,
        hasMoreTasks,
        loadMoreProfiles,
        loadMoreGroupThreads,
        loadMoreTasks,
        openHumanTaskCount,
        pendingHitlTasks,
        unseenHumanTasks,
        allHumanTasks,
        agentTasksStartedToday,
        deliverables,
        messages,
        loading,
        profilesLoading,
        plan,
        weeklyActionPlanCount,
        weeklyActionPlanLimit,
        weeklyLimitReached,
        signOut: handleSignOut,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
