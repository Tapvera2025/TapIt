import { registerResourcePolicy, type ResourcePolicy } from '@tapcrm/authz';
const receiptPolicy:ResourcePolicy={resourceType:'receipt',domain:'business',async check(ctx,_action,resource){return resource['organizationId']===ctx.organizationId;},async filter(){return {sql:'TRUE',parameters:[]};},participantFields(){return [];},initiatorField(){return null;}};
const bankPolicy:ResourcePolicy={resourceType:'bankReconciliation',domain:'business',async check(ctx,_action,resource){return resource['organizationId']===ctx.organizationId;},async filter(){return {sql:'TRUE',parameters:[]};},participantFields(){return [];},initiatorField(){return 'recordedBy';}};
export function registerPaymentPolicies(){registerResourcePolicy(receiptPolicy);registerResourcePolicy(bankPolicy);}
