'use client'

import { HeroHeader } from '@/components/layout/header'
import { Hero47 } from '@/components/hero47'
import { HeroTabs } from '@/components/hero-tabs'
import { AppleChatEffect } from '@/app/components/ui/apple-chat-effect'

export default function HeroSection() {
    return (
        <div className="relative w-full bg-neutral-100">
            <HeroHeader />
            <main>
                <div className="pt-20">
                    <Hero47 />
                </div>
                <HeroTabs />
                <section className="bg-white py-16 lg:py-24">
                    <div className="container mx-auto flex justify-center">
                        <AppleChatEffect className="text-neutral-900" speed={1.1} />
                    </div>
                </section>
            </main>
        </div>
    )
}
