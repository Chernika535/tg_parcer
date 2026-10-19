import { createClient } from "npm:@supabase/supabase-js@2.108.2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"content-type":"application/json"}});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const jwt=req.headers.get("authorization")?.replace(/^Bearer /i,"");
 if(!jwt)return json({error:"Требуется вход"},401);
 const githubToken=Deno.env.get("GITHUB_DEPLOY_TOKEN");
 if(!githubToken)return json({error:"Добавь секрет GITHUB_DEPLOY_TOKEN в Supabase"},503);
 try{
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")||Deno.env.get("SUPABASE_PUBLISHABLE_KEY")||"",{global:{headers:{Authorization:"Bearer "+jwt}},auth:{persistSession:false}});
  const {data:{user},error:authError}=await db.auth.getUser(jwt);
  if(authError||!user)return json({error:"Требуется вход"},401);
  const {data:profile,error:profileError}=await db.from("profiles").select("is_admin").eq("id",user.id).maybeSingle();
  if(profileError||profile?.is_admin!==true)return json({error:"Только администратор"},403);
  const api="https://api.github.com/repos/Chernika535/tg_parcer/contents/.seo-deploy-trigger";
  const headers={"Accept":"application/vnd.github+json","Authorization":"Bearer "+githubToken,"X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json","User-Agent":"polistay-seo-deploy"};
  const existing=await fetch(api+"?ref=main",{headers,signal:AbortSignal.timeout(12000)});
  if(existing.status!==200&&existing.status!==404)return json({error:"GitHub: ошибка чтения файла ("+existing.status+")"},502);
  const current=existing.ok?await existing.json() as {sha:string}:null;
  const marker="SEO rebuild requested at "+new Date().toISOString()+"\\n";
  const content=btoa(marker);
  const commit=await fetch(api,{method:"PUT",headers,body:JSON.stringify({message:"chore(seo): rebuild published blog articles",content,branch:"main",...(current?{sha:current.sha}:{})}),signal:AbortSignal.timeout(15000)});
  if(!commit.ok){const details=(await commit.text()).slice(0,250);return json({error:"GitHub отклонил коммит (HTTP "+commit.status+"): "+details},502)}
  const result=await commit.json() as {commit?:{sha?:string}};
  return json({queued:true,sha:result.commit?.sha||null});
 }catch(e){return json({error:"Не удалось запустить деплой: "+(e instanceof Error?e.message:String(e))},502)}
});
