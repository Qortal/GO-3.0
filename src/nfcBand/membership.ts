import { getBaseApiReact } from '../utils/globalApi';
import type { DoorScanResult } from './types';
import { parseBandPayload, verifyTicketSignature } from './ticket';

export async function fetchAddressPublicKey(
  address: string
): Promise<string | null> {
  try {
    const base = getBaseApiReact().replace(/\/$/, '');
    const res = await fetch(`${base}/addresses/publickey/${address}`);
    if (!res.ok) return null;
    const text = (await res.text()).replace(/"/g, '').trim();
    return text || null;
  } catch {
    return null;
  }
}

export async function isAddressInGroup(
  address: string,
  groupId: number
): Promise<boolean | null> {
  try {
    const base = getBaseApiReact().replace(/\/$/, '');
    const res = await fetch(`${base}/groups/member/${address}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    return data.some(
      (g: { groupId?: number; groupId?: string }) =>
        Number(g?.groupId) === Number(groupId)
    );
  } catch {
    return null;
  }
}

export async function verifyBandForGroup(
  rawPayload: string,
  requiredGroupId: number
): Promise<DoorScanResult> {
  const band = parseBandPayload(rawPayload);
  if (!band) {
    return { ok: false, reason: 'Not a Qortal band (unreadable or unpaired).' };
  }

  const ticket = band.tix.find((t) => Number(t.g) === Number(requiredGroupId));
  if (!ticket) {
    return {
      ok: false,
      reason: `No ticket for group ${requiredGroupId}. Ask the wearer to Refresh pass in GO.`,
      address: band.addr,
      name: band.name,
      deviceId: band.did,
      groupId: requiredGroupId,
    };
  }

  if (ticket.u < Date.now()) {
    return {
      ok: false,
      reason: 'Ticket expired. Refresh pass in Qortal GO.',
      address: band.addr,
      name: band.name,
      deviceId: band.did,
      groupId: requiredGroupId,
      validUntil: ticket.u,
    };
  }

  let publicKey = band.pk;
  const livePk = await fetchAddressPublicKey(band.addr);
  if (livePk) publicKey = livePk;

  const sigOk = verifyTicketSignature(ticket, {
    address: band.addr,
    deviceId: band.did,
    publicKeyBase58: publicKey,
  });
  if (!sigOk) {
    return {
      ok: false,
      reason: 'Invalid ticket signature (clone or tampered band).',
      address: band.addr,
      name: band.name,
      deviceId: band.did,
      groupId: requiredGroupId,
    };
  }

  const liveMember = await isAddressInGroup(band.addr, requiredGroupId);
  if (liveMember === false) {
    return {
      ok: false,
      reason: 'Signature ok, but address is not a current group member.',
      address: band.addr,
      name: band.name,
      deviceId: band.did,
      groupId: requiredGroupId,
      validUntil: ticket.u,
      liveMember: false,
    };
  }

  return {
    ok: true,
    reason:
      liveMember === true
        ? 'Access granted (ticket + live membership).'
        : 'Access granted (ticket valid; live membership check unavailable).',
    address: band.addr,
    name: band.name,
    deviceId: band.did,
    groupId: requiredGroupId,
    validUntil: ticket.u,
    liveMember,
  };
}
