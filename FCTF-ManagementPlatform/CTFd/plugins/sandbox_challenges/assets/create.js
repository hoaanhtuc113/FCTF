CTFd.plugin.run((_CTFd) => {
    const $ = _CTFd.lib.$;

    // ── Layer 1: Bootstrap modal event interceptor ─────────────────────────
    // Fires BEFORE Bootstrap shows #challenge-create-options.
    // For sandbox challenges: cancel the modal and redirect to the challenge
    // detail page instead. Bootstrap 3/4 checks e.isDefaultPrevented() on the
    // "show.bs.modal" event and aborts if true.
    //
    // Remove any previous sandbox handler first (in case loadChalTemplate
    // is called multiple times when the user switches challenge types).
    $('#challenge-create-options')
        .off('show.bs.modal.sandbox')
        .on('show.bs.modal.sandbox', function (e) {
            // Check if this page is currently rendering a sandbox create form
            var typeInput = document.getElementById('chaltype') ||
                            document.querySelector('#create-chal-entry-div input[name="type"]');
            if (!typeInput || typeInput.value !== 'sandbox') return;

            // Prevent Bootstrap from showing the modal
            e.preventDefault();
            e.stopImmediatePropagation();

            // The challenge was already created by challenge.js before .modal()
            // was called. Grab the challenge_id it stored in the modal.
            var challengeIdEl = document.querySelector('#challenge-create-options #challenge_id');
            var challengeId = challengeIdEl ? challengeIdEl.value : null;

            if (challengeId) {
                window.location = _CTFd.config.urlRoot + '/admin/challenges/' + challengeId;
            }
        });

    // ── DOM helpers ────────────────────────────────────────────────────────
    function el(id) { return document.getElementById(id); }
    function addClass(id, cls) { var e = el(id); if (e) e.classList.add(cls); }
    function removeClass(id, cls) { var e = el(id); if (e) e.classList.remove(cls); }

    // ── Sync hidden KYPO metadata fields ──────────────────────────────────
    function syncHiddenFields(opt) {
        el("kypo-instance-id").value = opt ? opt.value : "";
        el("kypo-access-token").value = opt ? (opt.dataset.accessToken || "") : "";
        el("kypo-instance-type").value = opt ? (opt.dataset.instanceType || "linear") : "";
    }

    // Điểm KHÔNG lấy từ KYPO nữa — admin tự nhập trong ô Score.
    // Chọn instance chỉ để lưu metadata (kypo_instance_id, access_token, type).

    // ── Populate the instance dropdown ────────────────────────────────────
    function loadInstances() {
        var loading = el("kypo-instance-loading");
        var select = el("kypo-instance-select");
        var errorEl = el("kypo-instance-error");

        if (!loading || !select) return;

        fetch("/api/v1/kypo/instances", {
            method: "GET",
            credentials: "same-origin",
            headers: { "Accept": "application/json", "CSRF-Token": _CTFd.csrftoken },
        })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                loading.style.display = "none";

                if (data.success && data.data && data.data.length > 0) {
                    data.data.forEach(function (inst) {
                        var opt = document.createElement("option");
                        opt.value = inst.id;
                        opt.textContent = "[" + inst.instance_type.toUpperCase() + "] " + inst.title;
                        opt.dataset.accessToken = inst.access_token || "";
                        opt.dataset.instanceType = inst.instance_type || "linear";
                        opt.dataset.definitionId = inst.training_definition_id || "";
                        select.appendChild(opt);
                    });

                    select.style.display = "block";

                    select.addEventListener("change", function () {
                        var opt = this.options[this.selectedIndex];
                        if (!opt || opt.value === "") {
                            syncHiddenFields(null);
                            return;
                        }
                        // Chỉ lưu metadata instance — KHÔNG fetch điểm từ KYPO
                        syncHiddenFields(opt);
                    });
                } else {
                    removeClass("kypo-instance-error", "d-none");
                }

                if (data.errors && data.errors.length > 0) {
                    console.warn("[KYPO] Partial errors:", data.errors);
                }
            })
            .catch(function (err) {
                if (loading) loading.style.display = "none";
                removeClass("kypo-instance-error", "d-none");
                console.error("[KYPO] Failed to fetch instances:", err);
            });
    }

    loadInstances();
});
