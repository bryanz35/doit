# Ubuntu 22.04 = glibc 2.35 + webkit2gtk-4.1.
# Build here so the bundles also run on older distros than Arch's glibc allows.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential curl wget file ca-certificates git pkg-config \
      libwebkit2gtk-4.1-dev \
      libgtk-3-dev \
      libayatana-appindicator3-dev \
      librsvg2-dev \
      libssl-dev \
      libsoup-3.0-dev \
      libjavascriptcoregtk-4.1-dev \
      patchelf desktop-file-utils fakeroot rpm squashfs-tools zsync xz-utils \
      xdg-utils librsvg2-bin libgdk-pixbuf2.0-bin \
    && rm -rf /var/lib/apt/lists/*

# Node 22 (matches the toolchain the frontend expects)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Rust, pinned to the host's version
ARG RUST_VERSION=1.97.0
ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo
ENV PATH=/opt/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs \
      | sh -s -- -y --no-modify-path --profile minimal --default-toolchain $RUST_VERSION

# linuxdeploy (what the AppImage step shells out to) cannot mount its own
# AppImage without /dev/fuse, so make every AppImage self-extract instead.
ENV APPIMAGE_EXTRACT_AND_RUN=1
# Ubuntu's strip mangles the webkit libs linuxdeploy copies in.
ENV NO_STRIP=true
# Keep cargo artifacts off the host target/, which holds Arch-linked objects.
ENV CARGO_TARGET_DIR=/cargo-target

WORKDIR /app
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
