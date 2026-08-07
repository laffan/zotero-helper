import SwiftRs
import Tauri
import UIKit

// Share-sheet plugin — presents a UIActivityViewController for a list
// of files already sitting on disk (the Rust core downloads/writes them
// to the app temp dir first). On iPad the sheet is a popover, so the
// frontend passes the anchor point of the Share button.

class ShareSheetPlugin: Plugin {
  struct ShareArgs: Decodable {
    let paths: [String]
    let x: Double
    let y: Double
  }

  @objc public func shareFiles(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ShareArgs.self)
    let urls = args.paths.map { URL(fileURLWithPath: $0) }
    guard !urls.isEmpty else {
      invoke.reject("Nothing to share")
      return
    }
    DispatchQueue.main.async {
      guard let top = self.topViewController() else {
        invoke.reject("No view controller to present the share sheet from")
        return
      }
      let vc = UIActivityViewController(activityItems: urls, applicationActivities: nil)
      if let popover = vc.popoverPresentationController {
        popover.sourceView = top.view
        popover.sourceRect = CGRect(x: args.x, y: args.y, width: 1, height: 1)
        popover.permittedArrowDirections = [.up, .down]
      }
      top.present(vc, animated: true)
      invoke.resolve()
    }
  }

  private func topViewController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive }
    let window = scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first
    guard var top = window?.rootViewController else { return nil }
    while let presented = top.presentedViewController {
      top = presented
    }
    return top
  }
}

@_cdecl("init_plugin_share_sheet")
func initPlugin() -> Plugin {
  return ShareSheetPlugin()
}
