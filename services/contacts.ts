export interface ContactMatch {
  name: string;
  contactId: string;
  imageUri?: string;
}

export async function requestAndCacheContacts(): Promise<boolean> {
  return false;
}

export async function lookupContact(
  senderName: string,
): Promise<ContactMatch | null> {
  return null;
}

export async function lookupContactByPhone(
  phone: string,
): Promise<ContactMatch | null> {
  return null;
}

export async function getContactPreviews(): Promise<ContactMatch[]> {
  return [];
}

export async function hasContactPermission(): Promise<boolean> {
  return false;
}
