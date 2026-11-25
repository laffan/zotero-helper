import SwiftRs
import Tauri
import UIKit
import WebKit

// The app's scenes (its iPad windows), once it takes more than one
// (UIApplicationSupportsMultipleScenes in Info.ios.plist). Two jobs, both
// about which scene iPadOS hands the app's content to. Ported from
// Hush's tauri-plugin-scene-reuse, where both were learned the hard way.
//
// 1. Links go to a window already open. With several scenes allowed,
//    iPadOS is free to make a new one for every zoterohelper:// link —
//    each tap on the Continue Reading widget would open an empty extra
//    window. Marking each scene as able to, and preferring to, take any
//    target content tells the system a window on screen can have it.
//
// 2. External displays are declined. The same opt-in makes the app
//    eligible for a connected monitor's session: plugging one in would
//    boot a second copy of the app onto a surface the pointer can't
//    reach and nothing in the app can close. That session's role is
//    non-interactive by design; the app has nothing to show there, so
//    the session is torn down and iPadOS mirrors instead. A window the
//    reader drags onto a monitor under Stage Manager is an ordinary
//    application scene and is left alone.
//
// The Rust side (src/lib.rs) declines the same sessions when Tauri asks
// whether to build a window for them: the two run off different
// notifications, in no set order, and both are idempotent.

class ScenesPlugin: Plugin {
  @objc public override func load(webview: WKWebView) {
    DispatchQueue.main.async {
      // A monitor attached at launch has its session already.
      for scene in UIApplication.shared.connectedScenes {
        self.apply(to: scene)
      }
      NotificationCenter.default.addObserver(
        self, selector: #selector(self.sceneWillConnect(_:)),
        name: UIScene.willConnectNotification, object: nil)
      NotificationCenter.default.addObserver(
        self, selector: #selector(self.sceneDidDisconnect(_:)),
        name: UIScene.didDisconnectNotification, object: nil)
    }
  }

  @objc private func sceneWillConnect(_ note: Notification) {
    if let scene = note.object as? UIScene {
      apply(to: scene)
    }
  }

  private func apply(to scene: UIScene) {
    if scene.session.role.rawValue.contains("ExternalDisplay") {
      decline(scene)
      return
    }
    let any = NSPredicate(value: true)
    scene.activationConditions.canActivateForTargetContentIdentifierPredicate = any
    scene.activationConditions.prefersToActivateForTargetContentIdentifierPredicate = any
  }

  /// Hidden, empty windows that keep declined scenes from being adopted
  /// (see decline), held until their scene goes.
  private var placeholders: [UIWindow] = []

  /// Claim the scene with an empty hidden window, hide what is in it,
  /// and ask for its session to be torn down. The placeholder matters:
  /// destruction is asynchronous, and a connected scene with no windows
  /// is what tao looks for when a new window needs a scene — a window
  /// opened meanwhile would land on the monitor being declined. If the
  /// system refuses, the windows are shown again: a hidden scene still
  /// owns its display and paints it black.
  private func decline(_ scene: UIScene) {
    let windows = (scene as? UIWindowScene)?.windows ?? []
    NSLog("Zotero Helper: declining an external-display scene (\(scene.session.role.rawValue))")
    if let windowScene = scene as? UIWindowScene {
      let placeholder = UIWindow(windowScene: windowScene)
      placeholder.isHidden = true
      placeholder.isUserInteractionEnabled = false
      placeholders.append(placeholder)
    }
    for window in windows {
      window.isHidden = true
    }
    UIApplication.shared.requestSceneSessionDestruction(
      scene.session, options: nil,
      errorHandler: { error in
        NSLog("Zotero Helper: the external-display scene stayed: \(error)")
        DispatchQueue.main.async {
          for window in windows {
            window.isHidden = false
          }
        }
      })
  }

  @objc private func sceneDidDisconnect(_ note: Notification) {
    guard let scene = note.object as? UIScene else { return }
    placeholders.removeAll { $0.windowScene == nil || $0.windowScene === scene }
  }
}

@_cdecl("init_plugin_scenes")
func initPlugin() -> Plugin {
  return ScenesPlugin()
}
