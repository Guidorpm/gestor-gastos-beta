(function () {
  'use strict';
  const integrated = new URL(location.href).searchParams.get('group_origin') === 'GRoup';
  window.GROUP_LOGIN = {
    options() {
      return integrated ? { auth: { storage: sessionStorage, storageKey: 'gestor-group-auth', persistSession: true, detectSessionInUrl: false } } : {};
    },
    async prepare(client, url, key) {
      if (!integrated) return;
      const current = new URL(location.href);
      const token = current.searchParams.get('group_token');
      if (!token) return; // Recarga del mismo módulo: su sesión individual se valida normalmente.
      current.searchParams.delete('group_token');
      history.replaceState(null, '', current.pathname + current.search + current.hash);
      await client.auth.signOut({ scope: 'local' });
      if (!/^[0-9a-f]{96}$/i.test(token)) throw new Error('Acceso inválido. Volvé a abrir el Gestor desde GRoup.');
      const response = await fetch(url + '/functions/v1/group-session-exchange', {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key },
        body: JSON.stringify({ group_token: token }), cache: 'no-store', signal: AbortSignal.timeout(30000)
      });
      const payload = await response.json();
      if (!response.ok || !payload.access_token || !payload.refresh_token) throw new Error(payload.error || 'No se pudo validar el acceso desde GRoup.');
      const { data, error } = await client.auth.setSession({ access_token: payload.access_token, refresh_token: payload.refresh_token });
      if (error || data.user?.id !== payload.user_id || data.user?.email?.toLowerCase() !== payload.email) {
        await client.auth.signOut({ scope: 'local' });
        throw new Error('La sesión no corresponde al usuario autorizado. Volvé a GRoup.');
      }
    }
  };
})();
