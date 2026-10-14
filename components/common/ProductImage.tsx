"use client";

import Image from "next/image";
import { useState } from "react";
import { Package } from "lucide-react";

interface ProductImageProps {
    src?: string;
    alt: string;
    sizes?: string;
    className?: string;
    priority?: boolean;
}

/**
 * Renders a product image with `next/image` fill layout — the parent element
 * must establish a sized, positioned (e.g. `relative aspect-*`) context.
 * Local paths and http(s) sources are supported; external images are served
 * unoptimized so no remote allowlist is required.
 */
export default function ProductImage({
    src,
    alt,
    sizes,
    className = "",
    priority = false,
}: ProductImageProps) {
    // Track the src that failed — a new src renders again automatically.
    const [failedSrc, setFailedSrc] = useState<string | null>(null);

    const validSrc =
        typeof src === "string" &&
        ((src.startsWith("/") && !src.startsWith("//")) || /^https?:\/\//i.test(src))
            ? src
            : null;

    if (!validSrc || failedSrc === validSrc) {
        return (
            <div
                className={`absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-surface-light text-muted ${className}`}
                role="img"
                aria-label={`${alt} — imagen no disponible`}
            >
                <Package className="w-8 h-8" aria-hidden />
                <span className="text-[11px]">Imagen no disponible</span>
            </div>
        );
    }

    const external = /^https?:\/\//i.test(validSrc);

    return (
        <Image
            src={validSrc}
            alt={alt}
            fill
            sizes={sizes}
            priority={priority}
            unoptimized={external}
            onError={() => setFailedSrc(validSrc)}
            className={`object-cover ${className}`}
        />
    );
}
