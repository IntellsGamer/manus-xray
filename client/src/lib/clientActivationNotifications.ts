export type ClientActivationNotificationResult = {
  id: number;
  activated: boolean;
  activationPending: boolean;
  activationFailed?: boolean;
};

export function claimClientActivationNotification(notifiedClientIds: Set<number>, result: ClientActivationNotificationResult) {
  if (!result.activated || result.activationPending || result.activationFailed || notifiedClientIds.has(result.id)) return false;
  notifiedClientIds.add(result.id);
  return true;
}
