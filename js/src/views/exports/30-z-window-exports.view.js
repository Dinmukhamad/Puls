/* Выделено из 30-admin-coins-groups-operators.view.js (3110 строк).
   Экспорт функций в window для инлайновых onclick в разметке. */

window.showAccountSettingsModal = showAccountSettingsModal;
window.submitChangeLogin        = submitChangeLogin;
window.submitChangePassword     = submitChangePassword;
window.showForcedPasswordChangeModal = showForcedPasswordChangeModal;
window.submitForcedPasswordChange = submitForcedPasswordChange;
window.logoutAndReload = logoutAndReload;

window.navigateTo = navigateTo;
window.reloadData = reloadData;
window.closeModal = closeModal;
window.submitAddOperator = submitAddOperator;
window.deactivateUserUi = deactivateUserUi;

window.setDynMode = function(mode) {
  // dynMode живёт внутри замыкания renderRating,
  // поэтому обновляем через глобальный колбэк
  if (window._setDynModeInternal) window._setDynModeInternal(mode);
};
window.showUserResetPasswordModal = showUserResetPasswordModal;
window.submitUserResetPassword = submitUserResetPassword;
window.showUserManagementModal = showUserManagementModal;
window.setUserManagementTab = setUserManagementTab;
window.submitUserManagement = submitUserManagement;
window.submitAddItem = submitAddItem;
window.submitEditItem = submitEditItem;
window.showAddOperatorModal = showAddOperatorModal;
window.showAddItemModal = showAddItemModal;
window.showEditItemModal = showEditItemModal;
window.exportCSV = exportCSV;
window.exportHistoryCSV = exportHistoryCSV;
window.reloadCabinet = reloadCabinet;
window.renderGroups = renderGroups;
window.showAddGroupModal = showAddGroupModal;
window.submitAddGroup = submitAddGroup;
window.showEditGroupModal = showEditGroupModal;
window.submitEditGroup = submitEditGroup;
window.toggleGroupStatus = toggleGroupStatus;
window.applyGroupStatus = applyGroupStatus;
window.confirmDeleteGroup = confirmDeleteGroup;
window.deleteGroup = deleteGroup;
window.showEditOperatorModal = showEditOperatorModal;
window.submitEditOperator = submitEditOperator;
window.resetOperatorPassword = resetOperatorPassword;
window.performResetOperatorPassword = performResetOperatorPassword;
window.confirmDismissOperator = confirmDismissOperator;
window.dismissOperator = dismissOperator;
window.showRestoreOperatorModal = showRestoreOperatorModal;
window.submitRestoreOperator = submitRestoreOperator;
window.confirmDeleteOperator = confirmDeleteOperator;
window.deleteOperator = deleteOperator;
window.showOperatorHistoryModal = showOperatorHistoryModal;
window.showChangePasswordModal = showChangePasswordModal;
window.showChangeUsernameModal = showChangeUsernameModal;
window.submitLegacyChangePassword = submitLegacyChangePassword;
window.submitChangePassword = submitChangePassword;
window.submitChangeUsername = submitChangeUsername;
window.copyCredentials = copyCredentials;
window.renderOperatorLevelsSettings = renderOperatorLevelsSettings;
window.recalculateOperatorLevelsUi = recalculateOperatorLevelsUi;
window.showCreateOperatorLevelPrompt = showCreateOperatorLevelPrompt;
window.submitOperatorLevelForm = submitOperatorLevelForm;
window.editOperatorLevelUi = editOperatorLevelUi;
window.addOperatorLevelRuleUi = addOperatorLevelRuleUi;
window.submitOperatorLevelRuleForm = submitOperatorLevelRuleForm;
window.deleteOperatorLevelRuleUi = deleteOperatorLevelRuleUi;
window.disableOperatorLevelUi = disableOperatorLevelUi;
window.manualOperatorLevelUi = manualOperatorLevelUi;
