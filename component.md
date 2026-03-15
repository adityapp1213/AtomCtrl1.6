import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from "motion/react";
import { cn } from "@/lib/utils";

const words = ["chat", "search", "shop", "code"] as const;

type CyclingWordsProps = React.ComponentProps<"div"> & {
  speed?: number;
  displayDuration?: number;
};

function CyclingWordsEffect({
  className,
  speed = 1,
  displayDuration = 1.2,
  ...props
}: CyclingWordsProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const textRef = useRef<SVGTextElement>(null);
  const [textWidth, setTextWidth] = useState(500);
  const clipProgress = useMotionValue(0);

  const currentWord = words[currentIndex];
  const drawDuration = 1.6 / speed;

  useEffect(() => {
    if (textRef.current) {
      const len = textRef.current.getComputedTextLength();
      setTextWidth(len);
    }
  }, [currentWord]);

  useEffect(() => {
    clipProgress.set(0);
    const controls = animate(clipProgress, 1, {
      duration: drawDuration,
      ease: [0.25, 0.1, 0.25, 1],
      onComplete: () => {
        setTimeout(() => {
          setCurrentIndex((prev) => (prev + 1) % words.length);
        }, displayDuration * 1000);
      },
    });
    return () => controls.stop();
  }, [currentIndex, drawDuration, displayDuration]);

  const clipWidth = useTransform(clipProgress, [0, 1], [0, textWidth + 40]);
  const clipId = `clip-${currentIndex}`;

  return (
    <div className={cn("flex items-center justify-center", className)} {...props}>
      <AnimatePresence mode="wait">
        <motion.div
          key={currentWord}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: "easeInOut" }}
        >
          <svg
            className="h-28 md:h-40 lg:h-52"
            viewBox="0 0 600 180"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <clipPath id={clipId}>
                <motion.rect
                  x={300 - textWidth / 2 - 20}
                  y="0"
                  height="180"
                  style={{ width: clipWidth }}
                />
              </clipPath>
            </defs>

            <text
              ref={textRef}
              x="300"
              y="140"
              textAnchor="middle"
              fontFamily="'Sacramento', cursive"
              fontSize="150"
              fill="none"
              stroke="none"
              style={{ visibility: "hidden" }}
            >
              {currentWord}
            </text>

            <text
              x="300"
              y="140"
              textAnchor="middle"
              fontFamily="'Sacramento', cursive"
              fontSize="150"
              fill="currentColor"
              clipPath={`url(#${clipId})`}
            >
              {currentWord}
            </text>
          </svg>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

const Index = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <CyclingWordsEffect className="text-foreground" speed={0.8} displayDuration={1.8} />
    </div>
  );
};

export default Index;
