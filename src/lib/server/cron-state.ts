import { serverDb } from './access';
export type CronStateSource = 'database' | 'default' | 'kv';
export type CronState = {enabled:boolean;source:CronStateSource;reason?:string};
export async function getCronTrackingEnabled(): Promise<CronState> {
  const db=serverDb();
  if(!db)return {enabled:false,source:'default',reason:'Database unavailable'};
  const {data,error}=await db.from('fleet_settings').select('tracking_enabled').eq('id',true).single();
  if(error)return {enabled:false,source:'default',reason:'Tracking settings unavailable'};
  return {enabled:data.tracking_enabled,source:'database'};
}
export async function setCronTrackingEnabled(enabled:boolean): Promise<CronState> {
  const db=serverDb();if(!db)throw new Error('Database unavailable');
  const {data,error}=await db.from('fleet_settings').update({tracking_enabled:enabled,updated_at:new Date().toISOString()}).eq('id',true).select('id').single();
  if(error||!data)throw new Error('Tracking settings could not be saved');
  return {enabled,source:'database'};
}
