/* ── Missions ──────────────────────────────────────────────────────────── */
(function attachMissionsApi() {
  function missionIdempotencyKey(prefix) {
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}-${random}`;
  }

  function getMissions() { return api._req('GET', '/api/missions'); }
  function getMissionWorlds() { return api._req('GET', '/api/missions/worlds'); }
  function getMissionWorld(code) { return api._req('GET', `/api/missions/worlds/${encodeURIComponent(code)}`); }
  function getMission(code) { return api._req('GET', `/api/missions/${encodeURIComponent(code)}`); }
  function startMission(code, key) {
    return api._req(
      'POST',
      `/api/missions/${encodeURIComponent(code)}/start`,
      undefined,
      { 'Idempotency-Key': key || missionIdempotencyKey('mission-start') },
    );
  }
  function getMissionAttempt(attemptId) {
    return api._req('GET', `/api/missions/attempts/${attemptId}`);
  }
  function submitMissionAction(attemptId, actionKey, payload = {}, key) {
    return api._req(
      'POST',
      `/api/missions/attempts/${attemptId}/actions`,
      { action_key: actionKey, payload },
      { 'Idempotency-Key': key || missionIdempotencyKey('mission-action') },
    );
  }
  function requestMissionHint(attemptId) {
    return api._req('POST', `/api/missions/attempts/${attemptId}/hint`);
  }
  function restartMission(attemptId, key) {
    return api._req(
      'POST',
      `/api/missions/attempts/${attemptId}/restart`,
      undefined,
      { 'Idempotency-Key': key || missionIdempotencyKey('mission-restart') },
    );
  }
  function getMissionStats(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return api._req('GET', '/api/admin/missions/stats' + (qs ? `?${qs}` : ''));
  }
  function listMissionAttempts(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return api._req('GET', '/api/admin/missions/attempts' + (qs ? `?${qs}` : ''));
  }
  function getAdminMissionWorlds() { return api._req('GET', '/api/admin/missions/worlds'); }
  function getMissionSettings(missionId) { return api._req('GET', `/api/admin/missions/${missionId}/settings`); }
  function updateProviderWindow(missionId, payload) {
    return api._req('PATCH', `/api/admin/missions/${missionId}/settings/provider-transfer-window`, payload);
  }
  function previewProviderWindow(missionId, params) {
    const qs = new URLSearchParams(params).toString();
    return api._req('GET', `/api/admin/missions/${missionId}/settings/provider-transfer-window/preview?${qs}`);
  }
  function updateDocumentSigningWindow(missionId, payload) {
    return api._req('PATCH', `/api/admin/missions/${missionId}/settings/document-signing-window`, payload);
  }
  function previewDocumentSigningWindow(missionId, params) {
    const qs = new URLSearchParams(params).toString();
    return api._req('GET', `/api/admin/missions/${missionId}/settings/document-signing-window/preview?${qs}`);
  }

  Object.assign(api, {
    getMissions,
    getMissionWorlds,
    getMissionWorld,
    getMission,
    startMission,
    getMissionAttempt,
    submitMissionAction,
    requestMissionHint,
    restartMission,
    getMissionStats,
    listMissionAttempts,
    getAdminMissionWorlds,
    getMissionSettings,
    updateProviderWindow,
    previewProviderWindow,
    updateDocumentSigningWindow,
    previewDocumentSigningWindow,
  });
})();
