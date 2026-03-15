'use client';

import { motion } from "motion/react";
import { cn } from "@/lib/utils";

type Props = React.ComponentProps<typeof motion.svg> & {
  speed?: number;
  onAnimationComplete?: () => void;
};

function AppleChatEffect({
  className,
  speed = 1,
  onAnimationComplete,
  ...props
}: Props) {
  const duration = 0.9 / speed;

  return (
    <motion.svg
      className={cn("h-20", className)}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 300 100"
      fill="none"
      {...props}
    >
      <title>chat</title>
      <motion.text
        x="50%"
        y="60%"
        textAnchor="middle"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration, ease: "easeOut" }}
        onAnimationComplete={onAnimationComplete}
        className="font-semibold"
        style={{
          fontFamily:
            'system-ui,-apple-system,BlinkMacSystemFont,"SF Pro Rounded","SF Pro Display",sans-serif',
          fontSize: 48,
        }}
      >
        chat
      </motion.text>
    </motion.svg>
  );
}

export { AppleChatEffect };
