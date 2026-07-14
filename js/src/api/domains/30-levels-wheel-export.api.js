  /* ── Tests (Тесты) — operator side ──────────────────────────── */
  async function myTests() { return req('GET', '/api/tests/my'); }
  async function startTest(testId) { return req('POST', `/api/tests/${testId}/start`); }
  async function saveTestAnswer(attemptId, questionId, selectedAnswerIds) {
    return req('POST', `/api/tests/attempts/${attemptId}/save-answer`, { question_id: questionId, selected_answer_ids: selectedAnswerIds });
  }
  async function finishTest(attemptId) { return req('POST', `/api/tests/attempts/${attemptId}/finish`); }
  async function getTestResult(attemptId) { return req('GET', `/api/tests/attempts/${attemptId}/result`); }

  /* ── Tests (Тесты) — admin/supervisor/manager side ──────────── */
  async function listAdminTests() { return req('GET', '/api/admin/tests'); }
  async function getAdminTest(testId) { return req('GET', `/api/admin/tests/${testId}`); }
  async function createTest(payload) { return req('POST', '/api/admin/tests', payload); }
  async function updateTest(testId, payload) { return req('PATCH', `/api/admin/tests/${testId}`, payload); }
  async function addTestQuestion(testId, payload) { return req('POST', `/api/admin/tests/${testId}/questions`, payload); }
  async function updateTestQuestion(questionId, payload) { return req('PATCH', `/api/admin/tests/questions/${questionId}`, payload); }
  async function deleteTestQuestion(questionId) { return req('DELETE', `/api/admin/tests/questions/${questionId}`); }
  async function assignTest(testId, payload) { return req('POST', `/api/admin/tests/${testId}/assign`, payload); }
  async function publishTest(testId) { return req('POST', `/api/admin/tests/${testId}/publish`); }
  async function closeTest(testId) { return req('POST', `/api/admin/tests/${testId}/close`); }
  async function getTestResults(testId, params) {
    const qs = new URLSearchParams(params || {}).toString();
    return req('GET', `/api/admin/tests/${testId}/results` + (qs ? '?' + qs : ''));
  }
  async function getTestAnalytics(testId) { return req('GET', `/api/admin/tests/${testId}/analytics`); }

  /* ── Operator levels ─────────────────────────────────────── */
  async function listOperatorLevels() { return req('GET', '/api/operator-levels'); }
  async function listAdminOperatorLevels() { return req('GET', '/api/admin/operator-levels'); }
  async function createOperatorLevel(payload) { return req('POST', '/api/admin/operator-levels', payload); }
  async function updateOperatorLevel(levelId, payload) { return req('PATCH', `/api/admin/operator-levels/${levelId}`, payload); }
  async function deleteOperatorLevel(levelId) { return req('DELETE', `/api/admin/operator-levels/${levelId}`); }
  async function addOperatorLevelRule(levelId, payload) { return req('POST', `/api/admin/operator-levels/${levelId}/rules`, payload); }
  async function updateOperatorLevelRule(ruleId, payload) { return req('PATCH', `/api/admin/operator-level-rules/${ruleId}`, payload); }
  async function deleteOperatorLevelRule(ruleId) { return req('DELETE', `/api/admin/operator-level-rules/${ruleId}`); }
  async function myLevel() { return req('GET', '/api/me/level'); }
  async function operatorLevel(operatorId) { return req('GET', `/api/operators/${operatorId}/level`); }
  async function recalculateOperatorLevels(payload) { return req('POST', '/api/admin/operator-levels/recalculate', payload || {}); }
  async function manualOperatorLevel(operatorId, payload) { return req('POST', `/api/admin/operators/${operatorId}/level/manual`, payload); }
  async function listOperatorLevelRewards() { return req('GET', '/api/admin/operator-levels/rewards'); }

  /* ── Wheel of WOW ───────────────────────────────────────── */
  async function getWheelStatus() { return req('GET', '/api/wheel/status'); }
  async function getWheelPrizes() { return req('GET', '/api/wheel/prizes'); }
  async function spinWheel() { return req('POST', '/api/wheel/spin'); }
  async function getWheelMyHistory() { return req('GET', '/api/wheel/my-history'); }
  async function getWheelSpins(params) {
    const qs = new URLSearchParams(params || {}).toString();
    return req('GET', '/api/admin/wheel/spins' + (qs ? '?' + qs : ''));
  }
  async function issueWheelTicket(payload) { return req('POST', '/api/admin/wheel/tickets', payload); }
  async function issueWheelTicketsBulk(payload) { return req('POST', '/api/admin/wheel/tickets/bulk', payload); }
  async function getWheelStats(params) {
    const qs = new URLSearchParams(params || {}).toString();
    return req('GET', '/api/admin/wheel/stats' + (qs ? '?' + qs : ''));
  }
  async function getWheelRules(params) {
    const qs = new URLSearchParams(params || {}).toString();
    return req('GET', '/api/admin/wheel/rules' + (qs ? '?' + qs : ''));
  }
  async function createWheelRule(payload) { return req('POST', '/api/admin/wheel/rules', payload); }
  async function updateWheelRule(id, payload) { return req('PATCH', '/api/admin/wheel/rules/' + id, payload); }
  async function getWheelTokens(params) {
    const qs = new URLSearchParams(params || {}).toString();
    return req('GET', '/api/admin/wheel/tokens' + (qs ? '?' + qs : ''));
  }
  async function getWheelEvaluationLogs(params) {
    const qs = new URLSearchParams(params || {}).toString();
    return req('GET', '/api/admin/wheel/evaluation-logs' + (qs ? '?' + qs : ''));
  }
  async function grantWheelTokens(payload) { return req('POST', '/api/admin/wheel/tokens/grant', payload); }
  async function getWheelWinnersToday() { return req('GET', '/api/wheel/winners-today'); }
  async function getWheelCampaigns() { return req('GET', '/api/admin/wheel/campaigns'); }
  async function createWheelCampaign(payload) { return req('POST', '/api/admin/wheel/campaigns', payload); }
  async function updateWheelCampaign(id, payload) { return req('PATCH', '/api/admin/wheel/campaigns/' + id, payload); }
  async function getWheelAdminPrizes(params) {
    const qs = new URLSearchParams(params || {}).toString();
    return req('GET', '/api/admin/wheel/prizes' + (qs ? '?' + qs : ''));
  }
  async function createWheelPrize(payload) { return req('POST', '/api/admin/wheel/prizes', payload); }
  async function updateWheelPrize(id, payload) { return req('PATCH', '/api/admin/wheel/prizes/' + id, payload); }

  return {
    getToken, login, me, logout,
    listOperators, getOperator, myOperator, createOperator, updateOperator,
    resetOperatorPassword, dismissOperator, restoreOperator, deleteOperator, operatorHistory,
    listWeekly, upsertWeekly,
    getRating,
    myWallet, operatorWallet, manualTransaction,
    listShopItems, createShopItem, updateShopItem,
    listPurchases, listShopDiscounts, buyItem, approvePurchase, rejectPurchase, completePurchase,
    listGroups, createGroup, updateGroup, enableGroup, disableGroup, deleteGroup,
    getDashboard, getDashboardOperators, getDashboardHistory,
    createUser, listUsers, updateUser, deactivateUser, changeUserRole, resetUserPassword,
    listSessions, revokeSession, revokeUserSessions,
    changeMyPassword, changeMyLogin, changeOperatorPassword, changeOperatorUsername,
    getCoinsOverview, listCoinRequests, listCoinTransactions,
    approveCoinRequest, rejectCoinRequest, completeCoinRequest,
    getPeriodReportStatus, uploadPeriodReportFiles, savePeriodReport,
    getAvailablePeriods, analyticsGet,
    getRatingRace, getMyRatingDynamics,
    myTests, startTest, saveTestAnswer, finishTest, getTestResult,
    listAdminTests, getAdminTest, createTest, updateTest, addTestQuestion, updateTestQuestion, deleteTestQuestion,
    assignTest, publishTest, closeTest, getTestResults, getTestAnalytics,
    listOperatorLevels, listAdminOperatorLevels, myLevel, operatorLevel,
    createOperatorLevel, updateOperatorLevel, deleteOperatorLevel,
    addOperatorLevelRule, updateOperatorLevelRule, deleteOperatorLevelRule,
    recalculateOperatorLevels, manualOperatorLevel, listOperatorLevelRewards,
    getWheelStatus, getWheelPrizes, spinWheel, getWheelMyHistory, getWheelSpins, issueWheelTicket, issueWheelTicketsBulk,
    getWheelStats, getWheelRules, createWheelRule, updateWheelRule, getWheelTokens, getWheelEvaluationLogs, grantWheelTokens,
    getWheelWinnersToday, getWheelCampaigns, createWheelCampaign, updateWheelCampaign,
    getWheelAdminPrizes, createWheelPrize, updateWheelPrize,
    getMyCabinet, getMyCabinetV2, getOperatorCabinet,
    getCoinRulesSettings, updateCoinRulesSettings,
    previewWeeklyAccrual, applyWeeklyAccrual, listAccrualRuns,
    listAchievements, updateAchievement, getMyAchievements, getOperatorAchievements, grantAchievement,
    getAdminSummary, exportUrl,
    listNotifications, getUnreadNotificationCount, markNotificationRead, markAllNotificationsRead,
    getMyRaffles, enterRaffle, listRafflesAdmin, createRaffle, drawRaffle, cancelRaffle,
    loginOperator: login,
    _base,
    _req: req,
  };
})();
