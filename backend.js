(function () {
  "use strict";

  const config = window.WORKLOG_CONFIG || {};

  function isRemote() {
    return config.storageMode === "sheets" && Boolean(config.apiBaseUrl);
  }

  async function loadState() {
    if (!isRemote()) return null;
    const response = await request("bootstrap", {});
    return response.data;
  }

  async function loadDashboard(forceRefresh) {
    if (!isRemote()) return null;
    const response = await request("dashboard", { forceRefresh: Boolean(forceRefresh) });
    return response.data;
  }

  async function saveEntry(entry) {
    if (!isRemote()) return null;
    return mutate("saveEntry", { entry });
  }

  async function saveEntries(entries) {
    if (!isRemote()) return null;
    return mutate("saveEntries", { entries });
  }

  async function deleteEntry(id) {
    if (!isRemote()) return null;
    return mutate("deleteEntry", { id });
  }

  async function saveBilling(row) {
    if (!isRemote()) return null;
    return mutate("saveBilling", { row });
  }

  async function saveBillings(rows) {
    if (!isRemote()) return null;
    return mutate("saveBillings", { rows });
  }

  async function deleteBilling(invoiceId) {
    if (!isRemote()) return null;
    return mutate("deleteBilling", { invoiceId });
  }

  async function saveTarget(row) {
    if (!isRemote()) return null;
    return mutate("saveTarget", { row });
  }

  async function saveTargets(rows) {
    if (!isRemote()) return null;
    return mutate("saveTargets", { rows });
  }

  async function deleteTarget(targetMonth, staffCode) {
    if (!isRemote()) return null;
    return mutate("deleteTarget", { targetMonth, staffCode });
  }

  async function upsertMaster(type, item, oldCode) {
    if (!isRemote()) return null;
    return mutate("upsertMaster", { type, item, oldCode: oldCode || "" });
  }

  async function removeMaster(type, code) {
    if (!isRemote()) return null;
    return mutate("removeMaster", { type, code });
  }

  // 案2: 工程マスタ
  async function saveTaskPhase(row) {
    if (!isRemote()) return null;
    return mutate("saveTaskPhase", { row });
  }

  async function saveTaskPhases(rows) {
    if (!isRemote()) return null;
    return mutate("saveTaskPhases", { rows });
  }

  async function deleteTaskPhase(taskCode, phaseCode) {
    if (!isRemote()) return null;
    return mutate("deleteTaskPhase", { taskCode, phaseCode });
  }

  // 案2: 顧客担当者マスタ
  async function saveCustomerStaff(row) {
    if (!isRemote()) return null;
    return mutate("saveCustomerStaff", { row });
  }

  async function saveCustomerStaffs(rows) {
    if (!isRemote()) return null;
    return mutate("saveCustomerStaffs", { rows });
  }

  async function deleteCustomerStaff(customerCode, staffCode) {
    if (!isRemote()) return null;
    return mutate("deleteCustomerStaff", { customerCode, staffCode });
  }

  // 案2: 設定
  async function saveSetting(key, value) {
    if (!isRemote()) return null;
    return mutate("saveSetting", { key, value });
  }

  async function mutate(action, payload) {
    try {
      return await request(action, payload);
    } finally {
      clearDashboardBrowserCache();
    }
  }

  function clearDashboardBrowserCache() {
    try {
      window.localStorage.removeItem("worklog-dashboard-cache-v2");
    } catch (error) {
      // localStorageが利用できない環境でも更新処理は継続する。
    }
  }

  function request(action, payload) {
    return new Promise((resolve, reject) => {
      const callbackName = `worklogCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      const params = new URLSearchParams({
        action,
        callback: callbackName,
        token: config.apiToken || "",
        payload: JSON.stringify(payload || {})
      });
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("APIの応答がありません"));
      }, 30000);

      window[callbackName] = (response) => {
        cleanup();
        if (!response || response.ok !== true) {
          reject(new Error((response && response.error) || "APIエラーが発生しました"));
          return;
        }
        resolve(response);
      };

      script.onerror = () => {
        cleanup();
        reject(new Error("APIに接続できません"));
      };

      function cleanup() {
        window.clearTimeout(timeout);
        delete window[callbackName];
        script.remove();
      }

      script.src = `${config.apiBaseUrl}?${params.toString()}`;
      document.head.appendChild(script);
    });
  }

  window.WorklogBackend = {
    isRemote,
    loadState,
    loadDashboard,
    saveEntry,
    saveEntries,
    deleteEntry,
    saveBilling,
    saveBillings,
    deleteBilling,
    saveTarget,
    saveTargets,
    deleteTarget,
    upsertMaster,
    removeMaster,
    saveTaskPhase,
    saveTaskPhases,
    deleteTaskPhase,
    saveCustomerStaff,
    saveCustomerStaffs,
    deleteCustomerStaff,
    saveSetting
  };
})();
