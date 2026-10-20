import { socialPage } from "../_social.js";
export async function onRequestGet({request,params,next}){return await socialPage(request,"feed",params.id) || next();}
