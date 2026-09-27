(function () {
  "use strict";

  if (window.__H5MKGv4Installed) return;
  window.__H5MKGv4Installed = true;

  var script = document.currentScript;
  var data = (script && script.dataset) || {};
  var config = {
    game: data.h5Game || "",
    build: data.h5Build || "",
    sdk: data.h5Sdk || "4.6.1",
    licenseUrl: data.h5LicenseUrl || "",
    reportUrl: data.h5ReportUrl || "",
    officialUrl: data.h5OfficialUrl || "https://www.madkidgames.com",
    development: data.h5Development === "true",
    timeoutMs: 10000
  };

  var nativeFetch = window.fetch.bind(window);
  var runtime = {
    state: 0,
    token: "",
    expiresAt: 0,
    refreshAfter: 180,
    refreshTimer: 0,
    retryCount: 0,
    activationRetryCount: 0,
    activationRetryTimer: 0,
    approvedOnce: false,
    requestInFlight: false,
    denialReason: "",
    assetBaseUrl: "",
    assetTicket: "",
    partnerDomain: "",
    distribution: "",
    unityConfig: null,
    unityAssetSources: {}
  };

  var readyResolve;
  var readyPromise = new Promise(function (resolve) {
    readyResolve = resolve;
  });

  window.__H5MKGv4Runtime = runtime;
  window.H5MadKidGamesLicenseReady = readyPromise;
  window.H5MadKidGamesGameEnum = config.game;
  window.H5MadKidGamesBuildId = config.build;
  window.H5MadKidGamesReportUrl = config.reportUrl;
  window.H5MadKidGamesLicenseApproved = false;
  window.H5MadKidGamesLicenseState = 0;

  function setPublicState(state) {
    runtime.state = state;
    window.H5MadKidGamesLicenseState = state;
    window.H5MadKidGamesLicenseApproved = state === 1;
  }

  function randomId(prefix) {
    try {
      var bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      return prefix + "_" + Array.prototype.map.call(bytes, function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
    } catch (error) {
      return prefix + "_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  }

  function sessionId() {
    if (window.H5MadKidGamesSessionId) return window.H5MadKidGamesSessionId;
    try {
      var value = sessionStorage.getItem("H5MadKidGamesSessionId");
      if (!value) {
        value = randomId("sess");
        sessionStorage.setItem("H5MadKidGamesSessionId", value);
      }
      window.H5MadKidGamesSessionId = value;
    } catch (error) {
      window.H5MadKidGamesSessionId = randomId("sess");
    }
    return window.H5MadKidGamesSessionId;
  }

  function automaticGameSlug() {
    try {
      var match = String(location.pathname || "").match(/\/games\/([a-z0-9](?:[a-z0-9-]{0,158}[a-z0-9])?)(?:\/|$)/i);
      return match ? String(match[1]).toLowerCase() : "";
    } catch (error) {
      return "";
    }
  }

  function embeddingOrigin() {
    function isOfficialHost(host) {
      host = String(host || "").toLowerCase().replace(/^www\./, "");
      return host === "madkidgames.com" || host.slice(-16) === ".madkidgames.com";
    }
    try {
      var origins = window.location.ancestorOrigins;
      if (origins && origins.length) {
        for (var i = 0; i < origins.length; i++) {
          var candidate = new URL(origins[i]);
          var host = candidate.hostname.toLowerCase().replace(/^www\./, "");
          if (!isOfficialHost(host)) return candidate.origin;
        }
      }
    } catch (error) {}
    try {
      if (document.referrer) {
        var referrer = new URL(document.referrer);
        var referrerHost = referrer.hostname.toLowerCase().replace(/^www\./, "");
        if (!isOfficialHost(referrerHost)) return referrer.origin;
      }
    } catch (error) {}
    return "";
  }

  function isOfficialRuntimeHost() {
    var host = String(location.hostname || "").toLowerCase().replace(/^www\./, "");
    return host === "madkidgames.com" || host.slice(-16) === ".madkidgames.com";
  }

  function activationRetryable(reason) {
    return isOfficialRuntimeHost() && [
      "build_activation_pending",
      "game_not_licensed",
      "build_not_licensed",
      "license_service_unavailable"
    ].indexOf(String(reason || "")) !== -1;
  }

  function localDenialDetails(reason) {
    if (!isOfficialRuntimeHost()) return null;
    var messages = {
      invalid_launch_grant: ["Reload required", "The secure game link expired or could not be verified. Reload the MadKidGames game page."],
      game_not_licensed: ["Game build unavailable", "This game is not active in the MadKidGames build registry."],
      build_not_licensed: ["Game update mismatch", "The uploaded WebGL files do not match the active MadKidGames build record."],
      build_activation_pending: ["Activating game update", "The complete WebGL package is still uploading, extracting, or being activated."],
      official_launch_required: ["Official launch required", "Open this game from its MadKidGames game page instead of loading index.html directly."],
      origin_not_licensed: ["Website origin unavailable", "The requested website origin is not enabled for this game."]
    };
    var entry = messages[String(reason || "")];
    if (!entry) return null;
    return {
      title: entry[0],
      summary: entry[1],
      owner_label: "Technical reason",
      owner: String(reason || "license_denied"),
      player_label: "Players",
      player: "Reload the official MadKidGames game page and try again."
    };
  }

  function embedPermit() {
    function fromSearch(search) {
      try { return new URLSearchParams(search || "").get("embed") || ""; }
      catch (error) { return ""; }
    }
    var permit = fromSearch(location.search);
    if (permit) return permit;
    try {
      if (window.parent && window.parent !== window) return fromSearch(window.parent.location.search);
    } catch (error) {}
    return "";
  }

  function launchGrant() {
    try {
      var queryGrant = new URLSearchParams(location.search || "").get("h5_launch") || "";
      if (queryGrant) return queryGrant;
    } catch (error) {}
    try {
      var own = document.querySelector('meta[name="h5-madkidgames-launch"]');
      if (own && own.content) return own.content;
    } catch (error) {}
    try {
      if (window.parent && window.parent !== window) {
        var parentMeta = window.parent.document.querySelector('meta[name="h5-madkidgames-launch"]');
        if (parentMeta && parentMeta.content) return parentMeta.content;
      }
    } catch (error) {}
    return "";
  }

  function protectedBuildUrl(input) {
    var url = "";
    try {
      url = typeof input === "string" ? input : input.url;
      var parsed = new URL(url, location.href);
      if (parsed.origin !== location.origin) return null;
      return /\/Build\/.*\.(?:data|wasm|mem|framework\.js|worker\.js)(?:\.br|\.gz|\.unityweb)?$/i.test(parsed.pathname)
        ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function authorizedBuildInput(input, parsed) {
    if (!runtime.assetBaseUrl || !runtime.assetTicket) return input;
    var marker = "/Build/";
    var offset = parsed.pathname.lastIndexOf(marker);
    var file = offset >= 0 ? parsed.pathname.slice(offset + marker.length) : parsed.pathname.split("/").pop();
    var target = new URL(file.replace(/^\/+/, ""), runtime.assetBaseUrl);
    target.searchParams.set("ticket", runtime.assetTicket);
    return target.href;
  }

  window.H5MadKidGamesAuthorizeUnityConfig = function (unityConfig) {
    if (!unityConfig || runtime.state !== 1 || !runtime.assetBaseUrl || !runtime.assetTicket) {
      return unityConfig;
    }
    runtime.unityConfig = unityConfig;
    ["dataUrl", "frameworkUrl", "codeUrl", "workerUrl", "memoryUrl"].forEach(function (key) {
      if (!runtime.unityAssetSources[key] && typeof unityConfig[key] === "string") {
        var original = protectedBuildUrl(unityConfig[key]);
        if (original) runtime.unityAssetSources[key] = unityConfig[key];
      }
      var source = runtime.unityAssetSources[key];
      if (typeof source !== "string") return;
      var parsed = protectedBuildUrl(source);
      if (parsed) unityConfig[key] = authorizedBuildInput(source, parsed);
    });
    return unityConfig;
  };

  // Defense in depth. The postprocessor also gates the loader script itself.
  window.fetch = function (input, init) {
    var parsed = protectedBuildUrl(input);
    if (!parsed) return nativeFetch(input, init);
    return readyPromise.then(function () {
      if (runtime.state !== 1) return new Promise(function () {});
      var authorizedInput = authorizedBuildInput(input, parsed);
      if (authorizedInput === input) return nativeFetch(input, init);
      var headers = typeof input === "object" && input.headers ? input.headers : (init && init.headers);
      return nativeFetch(authorizedInput, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        headers: headers
      });
    });
  };

  function notifyUnity(method, argument) {
    try {
      if (window.unityInstance && window.unityInstance.SendMessage) {
        window.unityInstance.SendMessage("H5MadKidGames", method, argument || "");
      }
    } catch (error) {}
  }

  function removeOverlay() {
    var overlay = document.getElementById("h5-madkidgames-license-block");
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  function showOverlay(title, message, retryable, details) {
    function render() {
      removeOverlay();
      var overlay = document.createElement("div");
      overlay.id = "h5-madkidgames-license-block";
      overlay.setAttribute("role", "alert");
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;" +
        "justify-content:center;background:#07182d;color:#fff;font-family:Arial,sans-serif;padding:24px;" +
        "text-align:center";

      var card = document.createElement("div");
      card.style.cssText = "max-width:560px;background:#0d2948;border:1px solid #315579;border-radius:14px;padding:30px";

      var heading = document.createElement("h1");
      heading.textContent = title;
      heading.style.cssText = "font-size:24px;margin:0 0 12px";

      var body = document.createElement("p");
      body.textContent = message;
      body.style.cssText = "font-size:16px;line-height:1.5;margin:0 0 20px;color:#dce9f6";

      var link = document.createElement("a");
      link.href = (details && details.cta_url) || config.officialUrl;
      link.textContent = (details && details.cta_label) || "Play on MadKidGames";
      link.rel = "noopener noreferrer";
      link.style.cssText =
        "display:inline-block;background:#ffc343;color:#17212b;text-decoration:none;font-weight:700;" +
        "border-radius:8px;padding:12px 18px;margin:4px";

      card.appendChild(heading);
      card.appendChild(body);

      if (details && typeof details === "object") {
        [[details.owner_label, details.owner], [details.player_label, details.player]].forEach(function (entry) {
          if (!entry[1]) return;
          var section = document.createElement("div");
          section.style.cssText = "margin:14px 0;text-align:left;padding:14px;background:#091f37;border-radius:10px";
          var label = document.createElement("strong");
          label.textContent = entry[0] || "Information";
          label.style.cssText = "display:block;margin-bottom:5px;color:#ffc343";
          var text = document.createElement("div");
          text.textContent = entry[1];
          text.style.cssText = "font-size:14px;line-height:1.5;color:#dce9f6";
          section.appendChild(label);
          section.appendChild(text);
          card.appendChild(section);
        });
      }
      card.appendChild(link);

      if (retryable) {
        var retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "Retry verification";
        retry.style.cssText =
          "background:#fff;color:#17212b;border:0;border-radius:8px;padding:12px 18px;margin:4px;cursor:pointer";
        retry.onclick = function () {
          retry.disabled = true;
          requestLicense(false);
        };
        card.appendChild(retry);
      }

      overlay.appendChild(card);
      document.body.appendChild(overlay);
    }

    if (document.body) render();
    else document.addEventListener("DOMContentLoaded", render, { once: true });
  }

  function approve(response) {
    if (!response || response.ok !== true || typeof response.token !== "string" || !response.token) {
      throw new Error("invalid_license_response");
    }
    if (!/^[A-Z0-9_]{1,100}$/.test(response.game_enum || "") ||
        (config.game && response.game_enum !== config.game) || response.build_id !== config.build) {
      throw new Error("license_binding_mismatch");
    }

    config.game = response.game_enum;
    window.H5MadKidGamesGameEnum = config.game;

    runtime.token = response.token;
    runtime.expiresAt = Number(response.expires_at || 0);
    runtime.refreshAfter = Math.max(30, Number(response.refresh_after || 180));
    runtime.retryCount = 0;
    runtime.activationRetryCount = 0;
    if (runtime.activationRetryTimer) clearTimeout(runtime.activationRetryTimer);
    runtime.activationRetryTimer = 0;
    runtime.denialReason = "";
    runtime.assetBaseUrl = typeof response.asset_base_url === "string" ? response.asset_base_url : "";
    runtime.assetTicket = typeof response.asset_ticket === "string" ? response.asset_ticket : "";
    runtime.partnerDomain = typeof response.partner_domain === "string" ? response.partner_domain : "";
    runtime.distribution = typeof response.distribution === "string" ? response.distribution : "";
    window.H5MadKidGamesRuntimeToken = runtime.token;
    window.H5MadKidGamesLicenseExpiresAt = runtime.expiresAt;
    window.H5MadKidGamesLicenseConfig = response.public_config || {};
    window.H5MadKidGamesPartnerDomain = runtime.partnerDomain;
    window.H5MadKidGamesDistribution = runtime.distribution;
    window.H5MadKidGamesAssetBaseUrl = runtime.assetBaseUrl;
    if (runtime.unityConfig) window.H5MadKidGamesAuthorizeUnityConfig(runtime.unityConfig);
    window.H5MadKidGamesDebugLogs = !!(response.public_config && response.public_config.debug_logs);
    setPublicState(1);
    removeOverlay();

    if (!runtime.approvedOnce) {
      runtime.approvedOnce = true;
      readyResolve(true);
    }

    notifyUnity("H5_OnLicenseApproved", String(runtime.expiresAt));
    scheduleRefresh(runtime.refreshAfter * 1000);
  }

  function deny(reason, retryable, details) {
    runtime.denialReason = reason || "license_denied";
    runtime.token = "";
    runtime.assetTicket = "";
    runtime.assetBaseUrl = "";
    window.H5MadKidGamesAssetBaseUrl = "";
    window.H5MadKidGamesRuntimeToken = "";
    setPublicState(retryable ? 0 : -1);
    notifyUnity("H5_OnLicenseRejected", runtime.denialReason);

    showOverlay(
      retryable ? ((details && details.title) || "Verification unavailable") : ((details && details.title) || "Embedding unavailable"),
      retryable
        ? ((details && details.summary) || "This game could not contact the MadKidGames license service. Check your connection and retry.")
        : (details ? (details.summary || "Access to this game has been restricted on this website.") : "This copy is not licensed for this website. Use the official version to support the developer."),
      retryable,
      details
    );
  }

  function expire() {
    if (runtime.state === -2) return;
    runtime.token = "";
    runtime.assetTicket = "";
    runtime.assetBaseUrl = "";
    window.H5MadKidGamesAssetBaseUrl = "";
    window.H5MadKidGamesRuntimeToken = "";
    setPublicState(-2);
    notifyUnity("H5_OnLicenseExpired", "expired");
    showOverlay(
      "License expired",
      "The game could not renew its MadKidGames license. Reconnect and reload the official page.",
      true
    );
  }

  function scheduleRefresh(delay) {
    if (runtime.refreshTimer) clearTimeout(runtime.refreshTimer);
    runtime.refreshTimer = setTimeout(function () {
      requestLicense(true);
    }, Math.max(5000, delay));
  }

  function requestLicense(isRefresh) {
    if (runtime.requestInFlight || !config.licenseUrl) return;
    runtime.requestInFlight = true;

    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timeout = setTimeout(function () {
      if (controller) controller.abort();
    }, config.timeoutMs);

    var payload = {
      // V4 initial authorization never trusts or requires a manually entered
      // enum. madkidgames.com resolves the registered game from build_id and
      // returns the authoritative enum. Refreshes bind to that returned enum.
      game_enum: isRefresh ? config.game : "",
      game_slug: automaticGameSlug(),
      identity_mode: "cloudarcade_slug",
      build_id: config.build,
      sdk_version: config.sdk,
      session_id: sessionId(),
      page_url: location.href,
      embedding_origin: embeddingOrigin(),
      embed_permit: embedPermit(),
      launch_grant: isRefresh ? "" : launchGrant(),
      is_embedded: window.top !== window.self,
      refresh_token: isRefresh ? runtime.token : ""
    };

    nativeFetch(config.licenseUrl, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      return response.json().then(function (body) {
        return { status: response.status, body: body };
      });
    }).then(function (result) {
      if (result.status !== 200 || !result.body || result.body.ok !== true) {
        var reason = (result.body && result.body.error) || "license_denied";
        var details = (result.body && result.body.message) || localDenialDetails(reason);
        if (!isRefresh && activationRetryable(reason) && runtime.activationRetryCount < 3) {
          runtime.activationRetryCount += 1;
          runtime.denialReason = reason;
          var retryDelay = Math.min(6000, 1000 * Math.pow(2, runtime.activationRetryCount - 1));
          runtime.activationRetryTimer = setTimeout(function () {
            runtime.activationRetryTimer = 0;
            requestLicense(false);
          }, retryDelay);
        } else if (reason === "build_activation_pending") {
          deny(reason, true, details);
        } else if (result.status === 403 || result.status === 404 || reason === "maintenance_mode") deny(reason, false, details);
        else throw new Error(reason);
        return;
      }
      approve(result.body);
    }).catch(function (error) {
      var now = Math.floor(Date.now() / 1000);
      if (runtime.approvedOnce && runtime.expiresAt > now) {
        runtime.retryCount += 1;
        scheduleRefresh(Math.min(30000, 5000 * runtime.retryCount));
      } else if (runtime.approvedOnce) {
        expire();
      } else {
        deny(error && error.message ? error.message : "license_unavailable", true);
      }
    }).finally(function () {
      clearTimeout(timeout);
      runtime.requestInFlight = false;
    });
  }

  runtime.requestRefresh = function () {
    requestLicense(true);
  };

  setInterval(function () {
    if (runtime.state === 1 && runtime.expiresAt > 0 && Math.floor(Date.now() / 1000) >= runtime.expiresAt) {
      expire();
    }
  }, 1000);

  var isLoopback = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(location.hostname);
  if (config.development && isLoopback) {
    config.game = config.game || "LOCAL_DEVELOPMENT";
    window.H5MadKidGamesGameEnum = config.game;
    approve({
      ok: true,
      token: "development-loopback",
      expires_at: Math.floor(Date.now() / 1000) + 86400,
      refresh_after: 3600,
      game_enum: config.game,
      build_id: config.build,
      public_config: { debug_logs: true, development: true }
    });
  } else {
    requestLicense(false);
  }
})();
