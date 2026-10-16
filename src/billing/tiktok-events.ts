import { Logger } from '@nestjs/common';
import { publicUrl } from '../common/public-url';
const logger = new Logger('TikTokEvents');
export async function trackTikTokPurchase(ev: {transactionId:number;value:number;planName:string}): Promise<boolean> {
 const token=process.env.TIKTOK_EVENTS_TOKEN?.trim();
 const pixel=process.env.TIKTOK_PIXEL_ID?.trim();
 if(!token || !pixel) return false;
 const value=Number(ev.value); if(!Number.isFinite(value)||value<=0)return false;
 try {
  const response=await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
   method:'POST',signal:AbortSignal.timeout(10000),
   headers:{'Content-Type':'application/json','Access-Token':token},
   body:JSON.stringify({event_source:'web',event_source_id:pixel,data:[{event:'Purchase',event_time:Math.floor(Date.now()/1000),event_id:`vm-tiktok-purchase-${ev.transactionId}`,user:{},page:{url:publicUrl('/')},properties:{currency:'BRL',value,content_type:'product',contents:[{content_id:ev.planName,content_name:`Plano ${ev.planName}`,quantity:1,price:value}]}}]})
  });
  const result:any=await response.json();
  if(!response.ok || result.code!==0){logger.warn(`Purchase rejected: HTTP ${response.status}, code ${result.code ?? 'unknown'}, request ${result.request_id ?? '-'}`);return false;}
  logger.log(`Purchase accepted for transaction ${ev.transactionId}`);return true;
 } catch {logger.warn('Purchase request unavailable');return false;}
}
