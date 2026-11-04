import type { Resource } from '@tapcrm/authz';
import type { RequestContext } from '../../../platform/dal/context.js';
import { db } from '../../../platform/dal/db.js';
import { sql } from '../../../platform/dal/sql.js';
import { route } from '../../../platform/http/route.js';
import { batchConfirmSchema,batchReviewSchema,confirmSchema,draftSchema,reviewSchema } from './validators.js';
import { confirmBatch,confirmDraft,createDraft,downloadInvoicePdf,getDraft,getPreview,listDrafts,listInvoices,reviewBatch,reviewDraft } from './service.js';
import { renderInvoicePdf } from './pdf.js';
async function loadInvoiceResource(ctx:RequestContext,id:string):Promise<Resource|null>{ const row=await db.maybeOne<{id:string;organizationId:string;createdBy:string}>(ctx,sql`SELECT id,organization_id AS "organizationId",created_by AS "createdBy" FROM finance_invoice_draft WHERE organization_id=${ctx.organizationId} AND id=${id}`); return row?{type:'invoice',...row}:null; }
export function registerInvoicingRoutes(){
  route({method:'GET',path:'/api/invoicing/drafts',action:'invoicing:view',module:'invoicing',handler:async({ctx})=>listDrafts(ctx)});
  route({method:'POST',path:'/api/invoicing/drafts',action:'invoicing:create',module:'invoicing',status:201,handler:async({ctx,body})=>createDraft(ctx,draftSchema.parse(body))});
  route({method:'GET',path:'/api/invoicing/drafts/:id',action:'invoicing:view',module:'invoicing',resourceParam:'id',loadResource:loadInvoiceResource,handler:async({ctx,params})=>getDraft(ctx,params['id']!)});
  route({method:'GET',path:'/api/invoicing/drafts/:id/preview',action:'invoicing:view',module:'invoicing',resourceParam:'id',loadResource:loadInvoiceResource,handler:async({ctx,params})=>getPreview(ctx,params['id']!)});
  route({method:'GET',path:'/api/invoicing/drafts/:id/preview.pdf',action:'invoicing:view',module:'invoicing',resourceParam:'id',loadResource:loadInvoiceResource,handler:async({ctx,params,res})=>{const draft=await getDraft(ctx,params['id']!);const body=await renderInvoicePdf(draft);res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','inline; filename="invoice-draft.pdf"');res.send(body);return null;}});
  route({method:'POST',path:'/api/invoicing/drafts/:id/review',action:'invoicing:view',module:'invoicing',resourceParam:'id',loadResource:loadInvoiceResource,handler:async({ctx,params,body})=>reviewDraft(ctx,params['id']!,reviewSchema.parse(body))});
  route({method:'POST',path:'/api/invoicing/drafts/:id/confirm',action:'invoicing:issue',module:'invoicing',resourceParam:'id',loadResource:loadInvoiceResource,handler:async({ctx,params,body})=>confirmDraft(ctx,params['id']!,confirmSchema.parse(body))});
  route({method:'POST',path:'/api/invoicing/batches/review',action:'invoicing:create',module:'invoicing',status:201,handler:async({ctx,body})=>reviewBatch(ctx,batchReviewSchema.parse(body))});
  route({method:'POST',path:'/api/invoicing/batches/:id/confirm',action:'invoicing:issue',module:'invoicing',resourceParam:'id',loadResource:loadInvoiceResource,handler:async({ctx,body})=>confirmBatch(ctx,batchConfirmSchema.parse(body))});
  route({method:'GET',path:'/api/invoicing/invoices',action:'invoicing:view',module:'invoicing',handler:async({ctx})=>listInvoices(ctx)});
  route({method:'GET',path:'/api/invoicing/invoices/:id/pdf',action:'invoicing:view',module:'invoicing',resourceParam:'id',loadResource:async(ctx,id)=>{const row=await db.maybeOne<{id:string;organizationId:string;createdBy:string}>(ctx,sql`SELECT i.id,i.organization_id AS "organizationId",i.issued_by AS "createdBy" FROM finance_invoice i WHERE i.organization_id=${ctx.organizationId} AND i.id=${id}`);return row?{type:'invoice',...row}:null;},handler:async({ctx,params,res})=>{const file=await downloadInvoicePdf(ctx,params['id']!);res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`inline; filename="${file.filename}"`);res.send(file.body);return null;}});
}
