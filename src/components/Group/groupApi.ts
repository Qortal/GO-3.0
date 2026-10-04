import {
  getArbitrarySearchSimpleEndpointReact,
  getBaseApiReact,
  getBaseApiReactForPrimaryName,
} from '../../App';
import {
  requestQueueAdminMemberNames,
  requestQueueMemberNames,
} from './groupQueues';
import {
  isOwnWalletAddress,
  rememberWalletPrimaryName,
} from '../../utils/walletPrimaryNameCache';

export async function getNameInfo(address: string): Promise<string> {
  const response = await fetch(`${getBaseApiReact()}/names/primary/` + address);
  const nameData = await response.json();

  if (nameData?.name) {
    return nameData.name;
  }
  return '';
}

/**
 * Primary name for avatar display (wallets/auth). Uses avatar-friendly base URL (e.g. HTTP when local HTTPS).
 * A lookup for one of this device's own wallets (the unlock screen, the
 * signed-in top bar) is remembered for the account picker, which no longer
 * asks the node about every saved wallet.
 */
export async function getPrimaryNameForAvatar(
  address: string
): Promise<string> {
  const response = await fetch(
    `${getBaseApiReactForPrimaryName()}/names/primary/` +
      encodeURIComponent(address)
  );
  const nameData = await response.json();
  const name = typeof nameData?.name === 'string' ? nameData.name : '';

  if (
    response.ok &&
    nameData &&
    typeof nameData === 'object' &&
    !('error' in nameData) &&
    isOwnWalletAddress(address)
  ) {
    void rememberWalletPrimaryName(address, name).catch(() => undefined);
  }

  return name;
}

/**
 * Primary names for many addresses in one request. Never send it the
 * wallets saved on this device, except to a node on this device itself: one
 * request listing them all tells the node which wallets share the phone (use
 * walletPrimaryNameCache instead).
 */
export async function getPrimaryNamesForAddresses(
  addresses: string[]
): Promise<Record<string, string>> {
  const uniqueAddresses = Array.from(
    new Set(addresses.filter((address) => Boolean(address)))
  );
  if (uniqueAddresses.length === 0) return {};

  const response = await fetch(
    `${getBaseApiReactForPrimaryName()}/names/list`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(uniqueAddresses),
    }
  );

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const names = await response.json();
  const primaryNamesByAddress: Record<string, string> = {};

  if (Array.isArray(names)) {
    names.forEach((item) => {
      if (typeof item?.owner !== 'string') return;
      primaryNamesByAddress[item.owner] =
        typeof item?.name === 'string' ? item.name : '';
    });
  }

  uniqueAddresses.forEach((address) => {
    if (primaryNamesByAddress[address] === undefined) {
      primaryNamesByAddress[address] = '';
    }
  });

  return primaryNamesByAddress;
}

export const getPublishesFromAdmins = async (
  admins: string[],
  groupId: string
): Promise<Record<string, unknown> | false> => {
  const queryString = admins.map((name) => `name=${name}`).join('&');
  const url = `${getBaseApiReact()}${getArbitrarySearchSimpleEndpointReact()}?mode=ALL&service=DOCUMENT_PRIVATE&identifier=symmetric-qchat-group-${groupId}&exactmatchnames=true&limit=0&reverse=true&${queryString}&prefix=true`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error('network error');
  }
  const adminData = await response.json();

  const filterId = adminData.filter(
    (data: { identifier?: string }) =>
      data.identifier === `symmetric-qchat-group-${groupId}`
  );

  if (filterId?.length === 0) {
    return false;
  }

  const sortedData = filterId.sort(
    (
      a: { updated?: string; created?: string },
      b: { updated?: string; created?: string }
    ) => {
      const dateA = a.updated ? new Date(a.updated) : new Date(a.created);
      const dateB = b.updated ? new Date(b.updated) : new Date(b.created);
      return dateB.getTime() - dateA.getTime();
    }
  );

  return sortedData[0];
};

export const getAllPublishesFromAdmins = async (
  admins: string[],
  groupId: string
): Promise<Record<string, unknown>[]> => {
  const queryString = admins.map((name) => `name=${name}`).join('&');
  const url = `${getBaseApiReact()}${getArbitrarySearchSimpleEndpointReact()}?mode=ALL&service=DOCUMENT_PRIVATE&identifier=symmetric-qchat-group-${groupId}&exactmatchnames=true&limit=0&reverse=true&${queryString}&prefix=true`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error('network error');
  }
  const adminData = await response.json();

  const filterId = adminData.filter(
    (data: { identifier?: string }) =>
      data.identifier === `symmetric-qchat-group-${groupId}`
  );

  if (filterId?.length === 0) {
    return [];
  }

  const sortedData = filterId.sort(
    (
      a: { updated?: string; created?: string },
      b: { updated?: string; created?: string }
    ) => {
      const dateA = a.updated ? new Date(a.updated) : new Date(a.created);
      const dateB = b.updated ? new Date(b.updated) : new Date(b.created);
      return dateB.getTime() - dateA.getTime();
    }
  );

  return sortedData;
};

export const getGroupAdminsAddress = async (
  groupNumber: number
): Promise<string[]> => {
  const response = await fetch(
    `${getBaseApiReact()}/groups/members/${groupNumber}?limit=0&onlyAdmins=true`
  );
  const groupData = await response.json();
  const members: string[] = [];
  if (groupData && Array.isArray(groupData?.members)) {
    for (const member of groupData.members) {
      if (member.member) {
        members.push(member.member);
      }
    }
  }
  return members;
};

export type GroupMemberEntry = {
  member: string;
  primaryName?: string;
  joined?: number;
};

export const getGroupMembers = async (
  groupNumber: number
): Promise<{
  members?: GroupMemberEntry[];
  memberCount?: number;
  [key: string]: unknown;
}> => {
  const response = await fetch(
    `${getBaseApiReact()}/groups/members/${groupNumber}?limit=0`
  );
  const groupData = await response.json();
  return groupData;
};

export const getGroupAdmins = async (
  groupNumber: number
): Promise<{
  names: string[];
  addresses: string[];
  both: { name: string; address: string; joined?: number }[];
}> => {
  const response = await fetch(
    `${getBaseApiReact()}/groups/members/${groupNumber}?limit=0&onlyAdmins=true`
  );
  const groupData = await response.json();
  const names: string[] = [];
  const membersAddresses: string[] = [];
  const both: { name: string; address: string; joined?: number }[] = [];

  groupData?.members?.forEach(
    (member: { member?: string; primaryName?: string; joined?: number }) => {
      if (member?.member) {
        membersAddresses.push(member.member);
        if (member.primaryName) {
          names.push(member.primaryName);
        }
        both.push({
          name: member.primaryName || '',
          address: member.member,
          joined: member.joined,
        });
      }
    }
  );

  return { names, addresses: membersAddresses, both };
};

export const getNames = async (
  listOfMembers: { member: string }[]
): Promise<{ member: string; name: string }[]> => {
  const members: { member: string; name: string }[] = [];

  const getMemNames = listOfMembers.map(async (member) => {
    if (member.member) {
      const name = await requestQueueMemberNames.enqueue(() =>
        getNameInfo(member.member)
      );
      if (name) {
        members.push({ ...member, name });
      } else {
        members.push({ ...member, name: '' });
      }
    }
    return true;
  });

  await Promise.all(getMemNames);

  return members;
};

export const getNamesForAdmins = async (
  admins: string[] | undefined
): Promise<{ address: string; name: string }[]> => {
  const members: { address: string; name: string }[] = [];

  const getMemNames = admins?.map(async (admin) => {
    if (admin) {
      const name = await requestQueueAdminMemberNames.enqueue(() =>
        getNameInfo(admin)
      );
      if (name) {
        members.push({ address: admin, name });
      }
    }
    return true;
  });
  await Promise.all(getMemNames || []);

  return members;
};
