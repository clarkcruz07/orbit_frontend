/*
 * Mobile sign-in return page logic (see mobile-redirect.html).
 *
 * Microsoft sends the phone here (an https address, so Microsoft shows no "custom link" warning). The mobile app put WHERE to go back to
 * inside the `state` value: "<random>.<base64url of the app's return link>". This page forwards everything Microsoft sent
 * (code, state, error...) to that return link, but ONLY if the link is one of the app's own: never an arbitrary address.
 */
(function (root) {
  // The app's real-build link, and Expo Go's link on a private (home / office Wi-Fi) address.
  var ALLOWED = [
    /^bluedge-people:\/\/auth$/,
    /^exp:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):\d{2,5}\/--\/auth$/,
  ]

  function decode(part) {
    var s = part.replace(/-/g, '+').replace(/_/g, '/')
    while (s.length % 4) s += '='
    return atob(s)
  }

  /** The app link to open for this page's query string, or null when it is missing or not one of the app's own. */
  function targetFor(search) {
    var query = String(search || '').replace(/^\?/, '')
    var state = new URLSearchParams(query).get('state') || ''
    var dot = state.indexOf('.')
    if (dot < 1) return null
    var back
    try {
      back = decode(state.slice(dot + 1))
    } catch (e) {
      return null
    }
    for (var i = 0; i < ALLOWED.length; i++) if (ALLOWED[i].test(back)) return back + '?' + query
    return null
  }

  /**
   * Android only: an explicit "open this app" link for an Expo Go target. Chrome always honours it (it names the app), where it can
   * refuse a bare exp:// link. null for anything else (the app's own build opens through its own link).
   */
  function androidIntentFor(target) {
    var m = /^exp:\/\/([^?]+)\?(.*)$/.exec(target || '')
    if (!m) return null
    return 'intent://' + m[1] + '?' + m[2] + '#Intent;scheme=exp;package=host.exp.exponent;end'
  }

  var api = { targetFor: targetFor, androidIntentFor: androidIntentFor }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.mobileRedirect = api
})(typeof window !== 'undefined' ? window : this)
