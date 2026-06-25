(function () {
  "use strict";

  const state = { staff: [], targets: [] };
  let month = "";
  const loaded = {};          // staffCode -> amount(number) for current month (null if none)
  const dirty = new Set();    // staffCodes changed for current month

  const el = {
    month: document.getElementById("targetMonth"),
    copyPrev: document.getElementById("copyPrev"),
    saveAll: document.getElementById("saveAll"),
    reload: document.getElementById("reload"),
    body: document.getElementById("targetBody"),
    total: document.getElementById("targetTotal"),
    dirtyInfo: document.getElementById("dirtyInfo"),
    status: document.getElementById("dataStatus"),
    toast: document.getElementById("toast")
  };

  init();

  async function init() {
    el.month.value = currentMonth();
    month = el.month.value;
    el.month.addEventListener("change", onMonthChange);
    el.copyPrev.addEventListener("click", copyPrev);
    el.saveAll.addEventListener("click", saveAll);
    el.reload.addEventListener("click", reload);
    el.body.addEventListener("input", onInput);
    await load();
  }

  function isRemote() {
    return Boolean(window.WorklogBackend && window.WorklogBackend.isRemote());
  }

  async function load() {
    setStatus("読み込み中…");
    if (isRemote()) {
      try {
        const db = await window.WorklogBackend.loadDashboard(true);
        if (db) {
          state.staff = (db.staff || []).map((s) => ({ code: String(s.code || "").trim(), name: String(s.name || "").trim() })).filter((s) => s.code);
          state.targets = (db.targets || []).map((t) => ({
            targetMonth: String(t.targetMonth || "").slice(0, 7),
            staffCode: String(t.staffCode || ""),
            staff: t.staff || "",
            targetAmount: Number(t.targetAmount || 0)
          }));
          setStatus("読み込みました");
        }
      } catch (error) {
        setStatus("読み込み失敗: " + error.message);
        showToast(error.message);
      }
    } else {
      setStatus("未接続（リモート設定が必要です）");
    }
    renderMonth();
  }

  async function reload() {
    if (dirty.size > 0 && !window.confirm("未保存の変更があります。破棄して再読込しますか？")) return;
    await load();
  }

  function onMonthChange() {
    if (dirty.size > 0 && !window.confirm("未保存の変更があります。破棄して月を切り替えますか？")) {
      el.month.value = month;
      return;
    }
    month = el.month.value;
    renderMonth();
  }

  function amountFor(m, code) {
    const row = state.targets.find((t) => t.targetMonth === m && String(t.staffCode) === String(code));
    return row ? Number(row.targetAmount || 0) : null;
  }

  function renderMonth() {
    dirty.clear();
    for (const k in loaded) delete loaded[k];

    if (!state.staff.length) {
      el.body.innerHTML = `<tr><td class="grid-empty" colspan="2">スタッフが登録されていません。先にマスタでスタッフを登録してください。</td></tr>`;
      el.total.textContent = "0";
      updateDirtyInfo();
      return;
    }
    const rows = state.staff.slice().sort((a, b) => String(a.code).localeCompare(String(b.code), "ja"));
    el.body.innerHTML = rows.map((s) => {
      const amt = amountFor(month, s.code);
      loaded[s.code] = amt;
      return `<tr data-staff="${esc(s.code)}">
        <td class="col-staff">${esc(s.code)} ${esc(s.name)}</td>
        <td class="num"><input class="cell-num" type="number" min="0" step="1000" inputmode="numeric" data-staff="${esc(s.code)}" value="${amt == null ? "" : amt}"></td>
      </tr>`;
    }).join("");
    recalcTotal();
    updateDirtyInfo();
  }

  function onInput(event) {
    const input = event.target.closest("input[data-staff]");
    if (!input) return;
    const code = input.dataset.staff;
    const tr = input.closest("tr");
    const cur = input.value.trim();
    const base = loaded[code];
    const changed = cur === "" ? base != null : Number(cur) !== Number(base == null ? NaN : base);
    if (changed) dirty.add(code); else dirty.delete(code);
    if (tr) tr.classList.toggle("is-dirty", dirty.has(code));
    recalcTotal();
    updateDirtyInfo();
  }

  function copyPrev() {
    const prev = addMonth(month, -1);
    let filled = 0;
    el.body.querySelectorAll("input[data-staff]").forEach((input) => {
      if (input.value.trim() !== "") return;
      const amt = amountFor(prev, input.dataset.staff);
      if (amt != null && amt > 0) {
        input.value = amt;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        filled += 1;
      }
    });
    showToast(filled ? `前月（${prev}）から${filled}件コピーしました` : `前月（${prev}）に目標がありません`);
  }

  async function saveAll() {
    const upserts = [];
    const deletes = [];
    el.body.querySelectorAll("input[data-staff]").forEach((input) => {
      const code = input.dataset.staff;
      if (!dirty.has(code)) return;
      const cur = input.value.trim();
      const staffName = (state.staff.find((s) => s.code === code) || {}).name || "";
      if (cur === "") {
        if (loaded[code] != null) deletes.push(code);
      } else {
        const amt = Number(cur);
        if (!Number.isFinite(amt) || amt < 0) return;
        upserts.push({ targetMonth: month, staffCode: code, staff: staffName, targetAmount: amt });
      }
    });

    if (upserts.length === 0 && deletes.length === 0) {
      showToast("保存する変更がありません");
      return;
    }

    el.saveAll.disabled = true;
    try {
      if (upserts.length) await window.WorklogBackend.saveTargets(upserts);
      for (const code of deletes) await window.WorklogBackend.deleteTarget(month, code);
    } catch (error) {
      showToast(error.message);
      el.saveAll.disabled = false;
      return;
    }
    el.saveAll.disabled = false;

    // ローカル state を更新
    upserts.forEach((u) => {
      const i = state.targets.findIndex((t) => t.targetMonth === u.targetMonth && String(t.staffCode) === String(u.staffCode));
      if (i >= 0) state.targets[i] = u; else state.targets.push(u);
    });
    deletes.forEach((code) => {
      state.targets = state.targets.filter((t) => !(t.targetMonth === month && String(t.staffCode) === String(code)));
    });

    renderMonth();
    showToast(`保存しました（更新${upserts.length}件・削除${deletes.length}件）`);
  }

  function recalcTotal() {
    let total = 0;
    el.body.querySelectorAll("input[data-staff]").forEach((input) => {
      const v = Number(input.value);
      if (Number.isFinite(v)) total += v;
    });
    el.total.textContent = "¥" + total.toLocaleString("ja-JP");
  }

  function updateDirtyInfo() {
    el.dirtyInfo.textContent = dirty.size ? `未保存 ${dirty.size}件` : "";
    el.saveAll.classList.toggle("secondary", dirty.size === 0);
  }

  function setStatus(t) { el.status.textContent = t; }

  function currentMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function addMonth(m, delta) {
    const [y, mo] = String(m).split("-").map(Number);
    const d = new Date(y, (mo - 1) + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  let toastTimer = null;
  function showToast(message) {
    window.clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.classList.add("show");
    toastTimer = window.setTimeout(() => el.toast.classList.remove("show"), 2400);
  }
})();
