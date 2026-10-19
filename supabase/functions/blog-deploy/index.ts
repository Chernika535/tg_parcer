import { createClient } from "npm:@supabase/supabase-js@2.108.2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"content-type":"application/json"}});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const token=req.headers.get("authorization")?.replace(/^Bearer /i,"");
 if(!token)return json({error:"Требуется вход"},401);
 const url=Deno.env.get("SUPABASE_URL")||"";
 const anon=Deno.env.get("SUPABASE_ANON_KEY")||Deno.env.get("SUPABASE_PUBLISHABLE_KEY")||"";
 const hook=Deno.env.get("ONREZA_DEPLOY_HOOK_URL")||"";
 if(!hook.startsWith("https://api.onreza.ru/v1/hooks/"))return json({error:"ONREZA_DEPLOY_HOOK_URL не настроен"},503);
 try{
  const db=createClient(url,anon,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false}});
  const {data:{user},error:authError}=await db.auth.getUser(token);
  if(authError||!user)return json({error:"Требуется вход"},401);
  const {data:profile,error:profileError}=await db.from("profiles").select("role,is_admin").eq("id",user.id).maybeSingle();
  if(profileError||!(profile?.role==="admin"||profile?.is_admin===true))return json({error:"Только администратор"},403);
  const body=await req.json().catch(()=>({})) as {slug?:string};
  const slug=String(body.slug||"");
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))return json({error:"Неверный адрес статьи"},400);
  const {data:article}=await db.from("blog_posts").select("slug,status").eq("slug",slug).eq("status","published").maybeSingle();
  if(!article)return json({error:"Статья не опубликована"},409);
  const git=await fetch("https://api.github.com/repos/Chernika535/tg_parcer/commits/main",{headers:{"Accept":"application/vnd.github+json","User-Agent":"polistay-blog-deploy"},signal:AbortSignal.timeout(8000)});
  if(!git.ok)return json({error:"Не удалось получить SHA main"},502);
  const commit=await git.json() as {sha?:string};
  if(!commit.sha||!/^[0-9a-f]{40}$/.test(commit.sha))return json({error:"Некорректный SHA"},502);
  const response=await fetch(hook,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({commitSha:commit.sha,branch:"main",message:"Blog SEO update: "+slug,force:true}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)return json({error:"Onreza отклонил запрос на сборку (HTTP "+response.status+")"},502);
  return json({queued:true});
 }catch(e){return json({error:"Ошибка запуска сборки: "+(e instanceof Error?e.message:String(e))},502)}
});
