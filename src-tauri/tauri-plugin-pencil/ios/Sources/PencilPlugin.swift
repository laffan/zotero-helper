import SwiftRs
import Tauri
import UIKit
import WebKit

// The Apple Pencil's double-tap (2nd generation, Pro) and squeeze
// (Pro), forwarded to the page as plugin events — there is no
// PointerEvent for either; UIPencilInteraction is the only way to hear
// them. The PDF viewer's ink mode switches tools on them
// (src/pdfviewer/ink/, through src/lib/pencil.ts).
//
// Each event carries the action the person chose for it in Settings →
// Apple Pencil ("switchEraser", "switchPrevious", "showColorPalette",
// "ignore", or "other" for the palettes and shortcuts the page has no
// equivalent of), so the Pencil does here what it does everywhere else.
//
// Also `hideEditMenu`: the system's text-selection menu (Copy, Look Up,
// Translate, Writing Tools…) comes up over a selection in the PDF and
// covers the viewer's own bar there, and nothing on the page can stop it
// — CSS (-webkit-touch-callout) doesn't reach it since iOS 16. Worse,
// while it is up, a tap on the bar only closes it: UIKit spends the tap
// on the menu, and the page never hears it. So:
// - while a selection in the PDF lasts, the page holds the menu off
//   (`hold`, src/lib/pencil.ts): the web views answer that no edit
//   action can be performed (`canPerformAction`, which WebKit's content
//   view asks its web view — the hook WebKit gives WKWebView subclasses
//   to trim the menu), so the menu has nothing in it and isn't shown.
//   Keyboard shortcuts (⌘C) are still answered. The bar has its own
//   Copy.
// - should a menu begin to show all the same, it is dismissed as it
//   does (WKUIDelegate's willPresentEditMenu, added to wry's delegate),
//   rather than when the page next looks;
// - and the page asks for it to be dismissed as a selection settles and
//   while it lasts: the menu is WebKit's UIEditMenuInteraction on its
//   content view, found among each web view's interactions and dismissed
//   (public API).
// Selections in the notes keep their menu — the page only holds the
// PDF's.
//
// Ported from Hush (tauri-plugin-pencil's PencilPlugin.swift), less its
// status-bar and keyboard-focus duties — this app's keyboard focus is
// tauri-plugin-keyboard-focus. As there, the interaction is added to
// the web view itself and nothing touches its scroll view's gesture
// recognizers: an earlier Hush version added one there to tell the
// Pencil from a finger, and it broke touch delivery to the page.

class PencilPlugin: Plugin {
  private var interaction: UIPencilInteraction?
  private weak var webView: WKWebView?

  @objc public override func load(webview: WKWebView) {
    webView = webview
    let interaction = UIPencilInteraction()
    interaction.delegate = self
    webview.addInteraction(interaction)
    self.interaction = interaction
  }

  struct HideArgs: Decodable {
    /// True: hold the menu off until false comes (a selection in the PDF
    /// began, or ended). Absent: only dismiss it now.
    let hold: Bool?
  }

  /// A selection in the PDF lasts: no edit action can be performed.
  private static var holding = false
  private static var guarded = false

  @objc public func hideEditMenu(_ invoke: Invoke) {
    let hold = (try? invoke.parseArgs(HideArgs.self))?.hold
    DispatchQueue.main.async { [weak self] in
      if let hold = hold {
        PencilPlugin.holding = hold
        if hold { self?.guardEditMenu() }
      }
      if hold != false { PencilPlugin.dismissEditMenu() }
    }
    invoke.resolve()
  }

  /// Every web view on screen, in every window (scene) of the app.
  private static func webViews() -> [WKWebView] {
    func find(_ view: UIView) -> [WKWebView] {
      if let web = view as? WKWebView { return [web] }
      return view.subviews.flatMap(find)
    }
    return UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .flatMap { find($0) }
  }

  private static func dismissEditMenu() {
    if #available(iOS 16.0, *) {
      for web in webViews() {
        for case let menu as UIEditMenuInteraction in interactions(in: web) {
          menu.dismissMenu()
        }
      }
    } else {
      UIMenuController.shared.hideMenu()
    }
  }

  /// Once: the web views' class answers `canPerformAction` with no while
  /// the menu is held (a key command apart), and their UI delegate hears
  /// of a menu about to show, to dismiss it. Both are added to the
  /// classes wry made (a WKWebView subclass, its delegate), leaving
  /// WebKit's own alone.
  private func guardEditMenu() {
    guard !PencilPlugin.guarded, let web = webView ?? PencilPlugin.webViews().first,
          let cls = object_getClass(web) else { return }
    PencilPlugin.guarded = true

    let can = #selector(UIResponder.canPerformAction(_:withSender:))
    if let method = class_getInstanceMethod(cls, can) {
      typealias Can = @convention(c) (AnyObject, Selector, Selector, AnyObject?) -> Bool
      let original = unsafeBitCast(method_getImplementation(method), to: Can.self)
      let held: @convention(block) (AnyObject, Selector, AnyObject?) -> Bool = { this, action, sender in
        if PencilPlugin.holding && !(sender is UIKeyCommand) { return false }
        return original(this, can, action, sender)
      }
      let imp = imp_implementationWithBlock(held)
      if !class_addMethod(cls, can, imp, method_getTypeEncoding(method)) {
        method_setImplementation(method, imp)
      }
    }

    if #available(iOS 16.4, *), let delegate = web.uiDelegate, let dcls = object_getClass(delegate) {
      let present = #selector(WKUIDelegate.webView(_:willPresentEditMenuWithAnimator:))
      if class_getInstanceMethod(dcls, present) == nil {
        let showing: @convention(block) (AnyObject, AnyObject, AnyObject) -> Void = { _, _, _ in
          if PencilPlugin.holding { DispatchQueue.main.async { PencilPlugin.dismissEditMenu() } }
        }
        class_addMethod(dcls, present, imp_implementationWithBlock(showing), "v@:@@")
        // WebKit notes which methods its delegate has as it is set.
        for view in PencilPlugin.webViews() where view.uiDelegate === delegate {
          view.uiDelegate = delegate
        }
      }
    }
  }

  /// Every interaction on a view and the views under it — WebKit keeps
  /// its edit menu on the content view inside the web view's scroll view.
  private static func interactions(in view: UIView) -> [UIInteraction] {
    view.interactions + view.subviews.flatMap { interactions(in: $0) }
  }

  fileprivate func send(_ event: String, _ action: UIPencilPreferredAction) {
    trigger(event, data: ["action": PencilPlugin.name(of: action)])
  }

  private static func name(of action: UIPencilPreferredAction) -> String {
    switch action {
    case .ignore: return "ignore"
    case .switchEraser: return "switchEraser"
    case .switchPrevious: return "switchPrevious"
    case .showColorPalette: return "showColorPalette"
    default: return "other"
    }
  }
}

extension PencilPlugin: UIPencilInteractionDelegate {
  @available(iOS 17.5, *)
  func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveTap tap: UIPencilInteraction.Tap) {
    send("tap", UIPencilInteraction.preferredTapAction)
  }

  @available(iOS 17.5, *)
  func pencilInteraction(_ interaction: UIPencilInteraction, didReceiveSqueeze squeeze: UIPencilInteraction.Squeeze) {
    // A squeeze has phases; it counts once, as it ends.
    guard squeeze.phase == .ended else { return }
    send("squeeze", UIPencilInteraction.preferredSqueezeAction)
  }

  /// Before iOS 17.5 the double-tap arrives here. Later systems call the
  /// method above instead; the check keeps a tap from counting twice
  /// should one deliver both.
  func pencilInteractionDidTap(_ interaction: UIPencilInteraction) {
    if #available(iOS 17.5, *) { return }
    send("tap", UIPencilInteraction.preferredTapAction)
  }
}

@_cdecl("init_plugin_pencil")
func initPlugin() -> Plugin {
  return PencilPlugin()
}
