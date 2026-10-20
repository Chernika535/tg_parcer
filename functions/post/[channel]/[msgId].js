import { socialPage } from "../../_social.js";
export async function onRequestGet({request,params,next}){return await socialPage(request,"post",null,params.channel,params.msgId) || next();}
