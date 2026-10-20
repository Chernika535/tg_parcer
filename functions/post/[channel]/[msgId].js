import { socialPage } from "../../_social.js";
export async function onRequestGet({request,params,next}){if(!/TelegramBot|Twitterbot|facebookexternalhit|WhatsApp|Slackbot|Discordbot|LinkedInBot|Pinterest|vkShare|Viber|SkypeUriPreview/i.test(request.headers.get("user-agent")||""))return next();
 return await socialPage(request,"post",null,params.channel,params.msgId) || next();}
