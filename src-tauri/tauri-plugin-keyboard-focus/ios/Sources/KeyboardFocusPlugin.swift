import GameController
import SwiftRs
import Tauri
import UIKit
import WebKit

// Hands the web view the hardware keyboard.
//
// On iPad a hardware key goes to the first responder and nowhere else.
// For the page that is WebKit's content view inside the WKWebView, and
// until it holds that role every shortcut is dropped before the page
// sees it — no `keydown` at any level, so nothing in lib/shortcuts/ can
// catch it.
//
// Nothing gives it the role at launch: wry makes the web view first
// responder on macOS but has no iOS equivalent, and the page can't do
// it for itself. WebKit promotes the content view only for a finger tap
// on editable text (focusing the notes, say), never for a programmatic
// `focus()`, and a trackpad or mouse click doesn't count. So the
// shortcuts worked only after the notes or a field had been tapped —
// and once that field let go of focus, they stopped again.
//
// So the native side claims it: at load, whenever a window becomes key
// or its scene activates (launch, app switch, Stage Manager), and when a
// keyboard connects — and at no other time. In particular not on the
// page's request after it blurs a text field: becoming first responder
// marks the page focused, and WebKit can hand that focus straight back
// to the field just let go (the notes), which then fights the page for
// the keyboard. Only while a hardware keyboard is attached — without
// one there are no shortcuts to deliver, and a claim with the notes
// focused would bring up the on-screen keyboard. A claim never takes
// the role from anything already holding it inside the web view, and
// stands aside while something is presented over the window (a share
// sheet, a picker), whose own responders own the keys.
//
// Ported from Hush (tauri-plugin-pencil's KeyboardFocus.swift).

class KeyboardFocusPlugin: Plugin {
  private weak var hostWebView: WKWebView?
  private static var observing = false

  @objc public override func load(webview: WKWebView) {
    hostWebView = webview
    observe()
    DispatchQueue.main.async { self.claimAtLoad(webview) }
  }

  private func observe() {
    guard !KeyboardFocusPlugin.observing else { return }
    KeyboardFocusPlugin.observing = true
    let center = NotificationCenter.default
    center.addObserver(forName: UIWindow.didBecomeKeyNotification, object: nil, queue: .main) { note in
      guard let window = note.object as? UIWindow else { return }
      KeyboardFocusPlugin.claim(in: window)
    }
    center.addObserver(forName: UIScene.didActivateNotification, object: nil, queue: .main) { note in
      guard let scene = note.object as? UIWindowScene else { return }
      for window in scene.windows { KeyboardFocusPlugin.claim(in: window) }
    }
    center.addObserver(forName: .GCKeyboardDidConnect, object: nil, queue: .main) { [weak self] _ in
      if let web = self?.hostWebView { KeyboardFocusPlugin.claim(web) }
    }
  }

  /// At load the web view may not be in its window yet, and
  /// `becomeFirstResponder` refuses a view without one — so try again
  /// for a few seconds; the notifications cover everything after that.
  private func claimAtLoad(_ webView: WKWebView, attempts: Int = 20) {
    if webView.window != nil {
      KeyboardFocusPlugin.claim(webView)
      return
    }
    guard attempts > 1 else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
      self?.claimAtLoad(webView, attempts: attempts - 1)
    }
  }

  private static func claim(in window: UIWindow) {
    // Only the app's window carries a web view; the keyboard's and other
    // system windows come back nil.
    guard let web = webView(in: window) else { return }
    claim(web)
  }

  private static func claim(_ webView: WKWebView) {
    guard GCKeyboard.coalesced != nil,
          let window = webView.window,
          window.rootViewController?.presentedViewController == nil,
          !holdsFirstResponder(webView) else { return }
    let took = webView.becomeFirstResponder()
    NSLog("[KeyboardFocus] web view first responder: \(took)")
  }

  private static func webView(in view: UIView) -> WKWebView? {
    if let web = view as? WKWebView { return web }
    for sub in view.subviews {
      if let web = webView(in: sub) { return web }
    }
    return nil
  }

  /// WKWebView itself never reports first responder — its content view
  /// takes the role — so look anywhere under it.
  private static func holdsFirstResponder(_ view: UIView) -> Bool {
    if view.isFirstResponder { return true }
    return view.subviews.contains(where: holdsFirstResponder)
  }
}

@_cdecl("init_plugin_keyboard_focus")
func initPlugin() -> Plugin {
  return KeyboardFocusPlugin()
}
