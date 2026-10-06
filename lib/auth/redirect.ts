export function safeRedirectPath(value: string | null | undefined): string {
    if (!value) return "/";
    if (!value.startsWith("/") || value.startsWith("//")) return "/";
    if (value.includes("\\") || value.toLowerCase().includes("javascript:")) return "/";
    return value;
}
