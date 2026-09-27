(function () {
  "use strict";

  var frame = document.getElementById("game-content");
  var panel = document.getElementById("mkg-h5-policy");
  var config = {};
  try {
    var encodedConfig = panel ? String(panel.getAttribute("data-mkg-config") || "") : "";
    if (/^[A-Za-z0-9_-]+$/.test(encodedConfig)) {
      var normalizedConfig = encodedConfig.replace(/-/g, "+").replace(/_/g, "/");
      normalizedConfig += "=".repeat((4 - normalizedConfig.length % 4) % 4);
      var binaryConfig = window.atob(normalizedConfig);
      var configBytes = new Uint8Array(binaryConfig.length);
      for (var configIndex = 0; configIndex < binaryConfig.length; configIndex += 1) {
        configBytes[configIndex] = binaryConfig.charCodeAt(configIndex);
      }
      config = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(configBytes));
    }
  } catch (error) {
    config = {};
  }
  var title = document.getElementById("mkg-h5-policy-title");
  var owner = document.getElementById("mkg-h5-policy-owner");
  var player = document.getElementById("mkg-h5-policy-player");
  var link = document.getElementById("mkg-h5-policy-link");
  var status = document.getElementById("mkg-h5-policy-status");
  var pollTimer = 0;

  function normalizeDomain(value) {
    try {
      var input = String(value || "").trim();
      var host = input.indexOf("://") >= 0 ? new URL(input).hostname : input.split("/")[0];
      host = host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "").replace(/:\d+$/, "");
      var labels = host.split(".");
      var invalidLabel = labels.some(function (label) {
        return !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label);
      });
      var official = host === "madkidgames.com" || host.slice(-16) === ".madkidgames.com";
      if (official || host.length > 253 || labels.length < 2 || invalidLabel
          || !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(labels[labels.length - 1])) {
        return "";
      }
      return host;
    } catch (error) {
      return "";
    }
  }

  function detectPartnerDomain() {
    try {
      if (window.location.ancestorOrigins && window.location.ancestorOrigins.length) {
        for (var i = 0; i < window.location.ancestorOrigins.length; i += 1) {
          var ancestor = normalizeDomain(window.location.ancestorOrigins[i]);
          if (ancestor) return ancestor;
        }
      }
    } catch (error) {}
    var referrerDomain = normalizeDomain(document.referrer);
    if (referrerDomain) return referrerDomain;
    try {
      var params = new URLSearchParams(window.location.search || "");
      return normalizeDomain(params.get("partner") || params.get("parthern") || params.get("partern") || "");
    } catch (error) {
      return "";
    }
  }

  function ensurePartnerTracking(domain) {
    try {
      var params = new URLSearchParams(window.location.search || "");
      var current = normalizeDomain(params.get("partner") || params.get("parthern") || params.get("partern") || "");
      if (current === domain) return false;

      // Keep existing query values such as embed permits, but use one
      // canonical partner key for CloudArcade view/source tracking.
      params.delete("parthern");
      params.delete("partern");
      params.set("partner", domain);
      var query = params.toString();
      window.location.replace(
        window.location.pathname + (query ? "?" + query : "") + (window.location.hash || "")
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  function defaultMessage(domain) {
    return {
      title: "Embedding unavailable",
      owner_label: "Website owner",
      owner: domain
        ? "Embedding is not currently authorized for \"" + domain + "\". To request access, contact admin@madkidgames.com."
        : "Embedding is not currently authorized for this website. To request access, contact admin@madkidgames.com.",
      player_label: "Players",
      player: "This game is unavailable on this website. Please play it on the official MadKidGames website.",
      cta_label: "Visit MadKidGames",
      cta_url: "https://www.madkidgames.com/"
    };
  }

  function showPanel(message) {
    var copy = message || defaultMessage("");
    panel.hidden = false;
    panel.classList.remove("is-working");
    title.textContent = copy.title || "Embedding unavailable";
    owner.textContent = copy.owner || "";
    player.textContent = copy.player || "";
    document.getElementById("mkg-h5-policy-owner-label").textContent = copy.owner_label || "Website owner";
    document.getElementById("mkg-h5-policy-player-label").textContent = copy.player_label || "Players";
    link.textContent = copy.cta_label || "Visit MadKidGames";
    link.href = copy.cta_url || "https://www.madkidgames.com/";
    link.hidden = false;
    status.hidden = true;
  }

  function stopGame(message) {
    if (pollTimer) window.clearInterval(pollTimer);
    if (frame) {
      frame.removeAttribute("src");
      frame.hidden = true;
    }
    showPanel(message);
  }

  function loadGame() {
    if (!frame || frame.getAttribute("src")) return;
    var source = frame.getAttribute("data-src");
    if (source) {
      frame.hidden = false;
      frame.setAttribute("src", source);
    }
    panel.hidden = true;
  }

  function parseResponse(response) {
    return response.json().catch(function () {
      return { ok: false, error: "invalid_server_response" };
    }).then(function (body) {
      body.httpOk = response.ok;
      return body;
    });
  }

  function checkPolicy(domain, firstCheck) {
    return fetch(config.policyUrl, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domain: domain,
        game_slug: config.gameSlug,
        sdk_version: "cloudarcade-wrapper"
      })
    }).then(parseResponse).then(function (result) {
      if (!result.allowed) {
        stopGame(result.message || defaultMessage(domain));
        return false;
      }
      if (firstCheck || (frame && !frame.getAttribute("src"))) loadGame();
      return true;
    }).catch(function () {
      if (config.authorized || config.mode === "migration") {
        // Existing partners continue during a temporary policy-service or
        // network failure. Explicit ban responses still stop the game above.
        if (firstCheck) loadGame();
        return true;
      }
      stopGame(defaultMessage(domain));
      return false;
    });
  }

  function beginPolicyPolling(domain) {
    checkPolicy(domain, true).then(function (allowed) {
      if (!allowed) return;
      var recheck = function () {
        checkPolicy(domain, false);
      };
      pollTimer = window.setInterval(function () {
        recheck();
      }, Number(config.pollMilliseconds || 60000));
      // Recheck as soon as an administrator returns to an already-open partner
      // tab after changing its status. The interval remains the configurable
      // background fallback.
      window.addEventListener("focus", recheck);
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) recheck();
      });
    });
  }

  if (!frame || !panel) return;
  if (config.blocked) {
    stopGame(config.message || defaultMessage(config.permitDomain));
    return;
  }
  var actuallyEmbedded = false;
  try { actuallyEmbedded = window.top !== window.self; } catch (error) { actuallyEmbedded = true; }
  if (!actuallyEmbedded) {
    loadGame();
    return;
  }

  var detected = detectPartnerDomain();
  if (!detected) {
    // Some browsers and privacy-focused partner sites provide neither
    // ancestorOrigins nor a Referer header. During migration, absence of that
    // optional signal must not take an existing partner offline.
    if (config.mode === "strict") stopGame(defaultMessage(""));
    else loadGame();
    return;
  }
  if (ensurePartnerTracking(detected)) {
    // Reload exactly once with ?partner={domain}. On the next request the
    // existing parameter prevents another reload and CloudArcade records the
    // partner gameplay view through its original tracking path.
    return;
  }
  if (config.permitDomain && normalizeDomain(config.permitDomain) !== detected) {
    if (config.mode === "strict") {
      stopGame(defaultMessage(detected));
      return;
    }
    // A copied or expired migration permit must not block an otherwise
    // auto-approved site. Evaluate the currently detected site instead.
  }
  if (!config.permitDomain || config.needsPermit || !config.authorized) {
    // Existing partner embeds are auto-approved by policy. Do not create a
    // stateful permit and reload the iframe: origin-local JSON registries can
    // otherwise cause an endless loop behind a multi-origin load balancer.
    beginPolicyPolling(detected);
    return;
  }
  beginPolicyPolling(detected);
})();
