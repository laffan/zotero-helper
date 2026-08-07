import SwiftRs
import Tauri
import UIKit
import WebKit

// Capture-view plugin — the iPad half of the "PDF rescue" browser.
//
// The React CaptureModal renders the chrome (header / footer) and tells
// us the rectangle its body occupies; we overlay a native WKWebView
// there. Compared to the desktop child-webview this is actually the
// stronger implementation:
//
//  * PDFs are recognized by RESPONSE MIME TYPE, not URL heuristics —
//    decidePolicyFor navigationResponse hands anything `application/pdf`
//    to WKDownload, which downloads inside the page's own
//    cookie/session context (paywalled PDFs the plain HTTP client
//    can't fetch come through fine).
//  * "Grab this page" re-fetches the current URL through a URLSession
//    primed with the webview's cookies, for inline viewers where no
//    navigation ever carries the PDF MIME type.
//  * Popup-style links (window.open / target=_blank) are folded into
//    the same webview via the WKUIDelegate createWebViewWith hook.
//
// Events emitted (JS subscribes via addPluginListener):
//   captured { jobId, path }    — PDF saved to the app temp dir
//   failed   { jobId, message } — a download or grab attempt failed
//
// WKDownload needs iOS 14.5, so every reference is availability-guarded
// (see the @available extension). This is NOT optional: Tauri compiles
// this package via swift-rs with its own hardcoded minimum-iOS target,
// ignoring Package.swift's `platforms` — raising the floor there does
// nothing, and unguarded WKDownload use fails the iOS build. At runtime
// the guards always pass (the app only ships to modern iPadOS).

class CaptureViewPlugin: Plugin, WKNavigationDelegate, WKUIDelegate {
  private var hostWebView: WKWebView?
  private var captureView: WKWebView?
  private var jobId: String = ""
  private var downloadDest: URL?

  @objc public override func load(webview: WKWebView) {
    self.hostWebView = webview
  }

  struct OpenArgs: Decodable {
    let url: String
    let jobId: String
    let x: Double
    let y: Double
    let w: Double
    let h: Double
  }

  struct BoundsArgs: Decodable {
    let x: Double
    let y: Double
    let w: Double
    let h: Double
  }

  private func frameFor(x: Double, y: Double, w: Double, h: Double) -> CGRect {
    // CSS pixels in the host webview == UIKit points, offset by wherever
    // the host sits in its superview (normally 0,0 / full-window).
    let origin = hostWebView?.frame.origin ?? .zero
    return CGRect(x: origin.x + x, y: origin.y + y, width: max(w, 50), height: max(h, 50))
  }

  @objc public func openCapture(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(OpenArgs.self)
    guard let target = URL(string: args.url) else {
      invoke.reject("Invalid URL: \(args.url)")
      return
    }
    DispatchQueue.main.async {
      self.teardown()
      guard let host = self.hostWebView, let parent = host.superview else {
        self.emitFailed("The capture view could not attach to the app window")
        return
      }
      self.jobId = args.jobId
      let config = WKWebViewConfiguration()
      config.websiteDataStore = .default()
      let wv = WKWebView(
        frame: self.frameFor(x: args.x, y: args.y, w: args.w, h: args.h),
        configuration: config
      )
      wv.navigationDelegate = self
      wv.uiDelegate = self
      wv.allowsBackForwardNavigationGestures = true
      parent.addSubview(wv)
      self.captureView = wv
      wv.load(URLRequest(url: target))
    }
    invoke.resolve()
  }

  @objc public func setBounds(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(BoundsArgs.self)
    DispatchQueue.main.async {
      self.captureView?.frame = self.frameFor(x: args.x, y: args.y, w: args.w, h: args.h)
    }
    invoke.resolve()
  }

  @objc public func goBack(_ invoke: Invoke) throws {
    DispatchQueue.main.async { self.captureView?.goBack() }
    invoke.resolve()
  }

  @objc public func closeCapture(_ invoke: Invoke) throws {
    DispatchQueue.main.async { self.teardown() }
    invoke.resolve()
  }

  /// Fetch whatever the capture view is showing through a URLSession
  /// primed with its cookies, and treat the result as the PDF.
  @objc public func grabPage(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      guard let wv = self.captureView, let url = wv.url else {
        self.emitFailed("No page is open to grab")
        return
      }
      wv.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
        var request = URLRequest(url: url)
        let relevant = cookies.filter { cookie in
          guard let host = url.host?.lowercased() else { return false }
          let domain = cookie.domain.hasPrefix(".")
            ? String(cookie.domain.dropFirst()).lowercased()
            : cookie.domain.lowercased()
          return host == domain || host.hasSuffix("." + domain)
        }
        let headers = HTTPCookie.requestHeaderFields(with: relevant)
        if let cookieHeader = headers["Cookie"] {
          request.setValue(cookieHeader, forHTTPHeaderField: "Cookie")
        }
        request.setValue("application/pdf,*/*", forHTTPHeaderField: "Accept")
        let session = URLSession(configuration: .ephemeral)
        session.dataTask(with: request) { data, response, error in
          if let error = error {
            self.emitFailed("Fetching the page failed: \(error.localizedDescription)")
            return
          }
          guard let data = data, data.count > 4 else {
            self.emitFailed("The page returned no data")
            return
          }
          let mime = (response as? HTTPURLResponse)?.mimeType?.lowercased() ?? ""
          let looksLikePdf = data.prefix(5) == Data("%PDF-".utf8)
          guard looksLikePdf || mime.contains("pdf") else {
            self.emitFailed("That page isn't a PDF — navigate to the PDF itself, or use its download button")
            return
          }
          guard looksLikePdf else {
            self.emitFailed("The server claimed a PDF but sent something else")
            return
          }
          var name = url.lastPathComponent
          if name.isEmpty || !name.lowercased().hasSuffix(".pdf") { name = "document.pdf" }
          let dest = self.tempDestination(for: name)
          do {
            try data.write(to: dest)
            self.emitCaptured(path: dest.path)
          } catch {
            self.emitFailed("Could not save the PDF: \(error.localizedDescription)")
          }
        }.resume()
      }
    }
    invoke.resolve()
  }

  // MARK: - Navigation policy

  public func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    if #available(iOS 14.5, *), navigationAction.shouldPerformDownload {
      decisionHandler(.download)
    } else {
      decisionHandler(.allow)
    }
  }

  public func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationResponse: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    let mime = navigationResponse.response.mimeType?.lowercased() ?? ""
    if #available(iOS 14.5, *),
      navigationResponse.isForMainFrame && mime == "application/pdf"
    {
      decisionHandler(.download)
    } else {
      decisionHandler(.allow)
    }
  }

  // Fold popups (window.open / target=_blank) into the same webview.
  public func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = navigationAction.request.url {
      webView.load(URLRequest(url: url))
    }
    return nil
  }

  // MARK: - Helpers

  private func tempDestination(for name: String) -> URL {
    let stamp = Int(Date().timeIntervalSince1970 * 1000)
    return FileManager.default.temporaryDirectory
      .appendingPathComponent("\(stamp)-\(name)")
  }

  private func emitCaptured(path: String) {
    var payload = JSObject()
    payload["jobId"] = self.jobId
    payload["path"] = path
    self.trigger("captured", data: payload)
  }

  private func emitFailed(_ message: String) {
    var payload = JSObject()
    payload["jobId"] = self.jobId
    payload["message"] = message
    self.trigger("failed", data: payload)
  }

  private func teardown() {
    captureView?.stopLoading()
    captureView?.removeFromSuperview()
    captureView = nil
  }
}

// MARK: - WKDownload (iOS 14.5+)
// The whole download pipeline is availability-gated: WKDownload first
// shipped in iOS 14.5. On the one WebKit release below that which can
// run this app, the policy handlers above simply .allow PDF navigations
// (the PDF renders inline) and "Grab this page" does the capturing.

@available(iOS 14.5, *)
extension CaptureViewPlugin: WKDownloadDelegate {
  public func webView(
    _ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload
  ) {
    download.delegate = self
  }

  public func webView(
    _ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload
  ) {
    download.delegate = self
  }

  public func download(
    _ download: WKDownload,
    decideDestinationUsing response: URLResponse,
    suggestedFilename: String,
    completionHandler: @escaping (URL?) -> Void
  ) {
    var name = suggestedFilename.isEmpty ? "document.pdf" : suggestedFilename
    if !name.lowercased().hasSuffix(".pdf") { name += ".pdf" }
    let dest = tempDestination(for: name)
    self.downloadDest = dest
    completionHandler(dest)
  }

  public func downloadDidFinish(_ download: WKDownload) {
    guard let dest = self.downloadDest else { return }
    self.downloadDest = nil
    emitCaptured(path: dest.path)
  }

  public func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    self.downloadDest = nil
    emitFailed("Download failed: \(error.localizedDescription)")
  }
}

@_cdecl("init_plugin_capture_view")
func initPlugin() -> Plugin {
  return CaptureViewPlugin()
}
