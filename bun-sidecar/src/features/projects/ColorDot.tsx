interface ColorDotProps {
    color?: string;
    size?: number;
}

export function ColorDot({ color, size = 10 }: ColorDotProps) {
    if (!color) return null;
    return (
        <span
            style={{
                display: "inline-block",
                width: size,
                height: size,
                borderRadius: "50%",
                backgroundColor: color,
                flexShrink: 0,
            }}
        />
    );
}
