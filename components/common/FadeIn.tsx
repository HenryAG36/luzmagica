import { ReactNode } from "react";

interface FadeInProps {
    children: ReactNode;
    delay?: number;
    direction?: "up" | "down" | "left" | "right";
    className?: string;
}

// Progressive enhancement: content renders immediately (SSR + reduced-motion
// safe). The signature is kept for callers that pass delay/direction.
export default function FadeIn({ children, className = "" }: FadeInProps) {
    return <div className={className}>{children}</div>;
}
