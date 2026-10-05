//! Touchpad pinch → calendar zoom, Linux only.
//!
//! WebKitGTK takes a touchpad pinch for itself and magnifies the whole page;
//! the page never gets an event for it (https://bugs.webkit.org/show_bug.cgi?id=257693).
//! A capture-phase zoom gesture on the webview claims the pinch before WebKit
//! sees it and forwards each step to the frontend as a `pinch` event, which the
//! calendar's hour grid applies like Ctrl + wheel.

use std::cell::Cell;
use std::rc::Rc;

use gtk::prelude::*;
use serde::Serialize;
use tauri::{Emitter, WebviewWindow};

/// One step of a pinch: scale the zoom by `factor` around `(x, y)`, in CSS
/// px from the webview's top-left — the same space as `clientX`/`clientY`.
#[derive(Clone, Serialize)]
struct Pinch {
    factor: f64,
    x: f64,
    y: f64,
}

pub fn install(window: &WebviewWindow) -> tauri::Result<()> {
    let emitter = window.clone();
    window.with_webview(move |webview| {
        let view = webview.inner();
        let gesture = gtk::GestureZoom::new(&view);
        gesture.set_propagation_phase(gtk::PropagationPhase::Capture);

        // GTK reports the scale since the pinch began; the frontend wants the
        // change since the last step, so remember the previous one.
        let last = Rc::new(Cell::new(1.0));
        let start = last.clone();
        gesture.connect_begin(move |gesture, _| {
            start.set(1.0);
            // Claiming it here is what keeps WebKit from zooming the page.
            gesture.set_state(gtk::EventSequenceState::Claimed);
        });
        gesture.connect_scale_changed(move |gesture, scale| {
            let factor = scale / last.replace(scale);
            let (x, y) = gesture.bounding_box_center().unwrap_or_default();
            let _ = emitter.emit("pinch", Pinch { factor, x, y });
        });

        // A GTK3 widget does not own its gestures; this closure holds the
        // gesture until the webview is destroyed.
        view.connect_destroy(move |_| {
            let _ = &gesture;
        });
    })
}
