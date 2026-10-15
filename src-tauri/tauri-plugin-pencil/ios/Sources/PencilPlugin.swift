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
// Ported from Hush (tauri-plugin-pencil's PencilPlugin.swift), less its
// status-bar and keyboard-focus duties — this app's keyboard focus is
// tauri-plugin-keyboard-focus. As there, the interaction is added to
// the web view itself and nothing touches its scroll view's gesture
// recognizers: an earlier Hush version added one there to tell the
// Pencil from a finger, and it broke touch delivery to the page.

class PencilPlugin: Plugin {
  private var interaction: UIPencilInteraction?

  @objc public override func load(webview: WKWebView) {
    let interaction = UIPencilInteraction()
    interaction.delegate = self
    webview.addInteraction(interaction)
    self.interaction = interaction
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
