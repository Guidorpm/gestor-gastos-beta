import { createClient } from "npm:@supabase/supabase-js@2";

const GROUP_URL = "https://hnxgxufixlhlcxajgtui.supabase.co";
const GROUP_KEY = "sb_publishable_iji-qaGXMWJtGQT34umtog_JOJnEm3F";
const ORIGINS = new Set(["https://guidorpm.github.io", "https://gestor-gastos-rizzo.onrender.com"]);

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const headers = { "Access-Control-Allow-Origin": ORIGINS.has(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store", "Vary": "Origin" };
  const reply = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...headers, "Content-Type": "application/json" } });
  if (!ORIGINS.has(origin)) return reply({ error: "Origen no autorizado" }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply({ error: "Método no permitido" }, 405);
  let targetClient;
  try {
    const { group_token } = await req.json();
    if (typeof group_token !== "string" || !/^[0-9a-f]{96}$/i.test(group_token)) return reply({ error: "Acceso GRoup inválido" }, 401);
    const response = await fetch(`${GROUP_URL}/rest/v1/rpc/group_consumir_token_acceso_modulo`, {
      method: "POST", headers: { apikey: GROUP_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ p_token: group_token }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) return reply({ error: "El acceso GRoup venció o no está autorizado. Volvé a abrir el programa." }, 401);
    const result = await response.json();
    const identity = Array.isArray(result) ? result[0] : result;
    if (identity?.empresa_nombre !== "GR" || identity?.modulo_nombre !== "Gestor de Servicios") return reply({ error: "Acceso de otra empresa o programa" }, 403);
    const email = String(identity.usuario_email || "").trim().toLowerCase();
    const role = String(identity.rol_modulo || "").toLowerCase();
    if (!email || !["titular", "operador", "viewer", "lectura"].includes(role)) return reply({ error: "Identidad no autorizada" }, 403);
    const projectUrl = Deno.env.get("SUPABASE_URL");
    const admin = createClient(projectUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
    // Solamente cuentas existentes con el mismo correo; nunca se crean usuarios ni se adivinan alias.
    const { data: listing, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) throw new Error("No se pudieron validar las cuentas");
    const matches = listing.users.filter(user => String(user.email || "").toLowerCase() === email);
    if (matches.length !== 1) return reply({ error: "Falta vincular la cuenta existente del Gestor con tu correo de GRoup" }, 403);
    const user = matches[0];
    if ((user.banned_until && Date.parse(user.banned_until) > Date.now()) || !user.email_confirmed_at || user.factors?.some(factor => factor.status === "verified")) {
      return reply({ error: "La cuenta requiere revisión o su verificación adicional" }, 403);
    }
    const { data: internal, error: internalError } = await admin.from("internal_accounts").select("active,must_change_password").eq("user_id", user.id).maybeSingle();
    if (internalError) throw new Error("No se pudo validar el estado interno");
    if (internal?.active === false || internal?.must_change_password) return reply({ error: "La cuenta interna está bloqueada o requiere actualizar su contraseña" }, 403);
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (linkError || link?.user?.id !== user.id || !link.properties?.hashed_token) throw new Error("No se pudo generar la sesión individual");
    targetClient = createClient(projectUrl, Deno.env.get("SUPABASE_ANON_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: login, error: loginError } = await targetClient.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "email" });
    if (loginError || login.user?.id !== user.id || !login.session) throw new Error("No se pudo validar la sesión individual");
    const { data: permissions, error: permissionError } = await targetClient.rpc("current_platform_permissions");
    const { data: memberships, error: membershipError } = await targetClient.from("memberships").select("groups(created_by)").eq("user_id", user.id).eq("active", true);
    if (permissionError || membershipError) throw new Error("No se pudieron verificar los permisos existentes");
    const permission = Array.isArray(permissions) ? permissions[0] : permissions;
    const privileged = permission?.is_platform_admin || permission?.can_manage_access || permission?.can_create_spaces || memberships?.some(item => item.groups?.created_by === user.id);
    if (!memberships?.length || (role !== "titular" && privileged)) {
      await targetClient.auth.signOut({ scope: "local" });
      return reply({ error: "Los permisos del Gestor requieren conciliación con GRoup" }, 403);
    }
    // Se devuelven credenciales exclusivamente de la cuenta validada, nunca la clave administrativa.
    return reply({ access_token: login.session.access_token, refresh_token: login.session.refresh_token,
      user_id: user.id, email });
  } catch (_) {
    if (targetClient) await targetClient.auth.signOut({ scope: "local" }).catch(() => {});
    return reply({ error: "No se pudo completar el ingreso seguro. Volvé a abrir el programa desde GRoup." }, 400);
  }
});
