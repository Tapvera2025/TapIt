export const PLATFORM_EVENTS = {
  ORGANIZATION_CREATED: 'platform.organization.created',
  MODULE_CHANGED: 'platform.organization.module.changed',
  ADMIN_INVITED: 'platform.organization.admin.invited',
  ADMIN_INVITATION_ACCEPTED: 'platform.organization.admin.invitation.accepted',
} as const;

export const AUTHORIZATION_EVENTS = {
  PERMISSIONS_CHANGED: 'permissions:changed',
} as const;
