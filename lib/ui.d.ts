/** Native DSH main-panel contribution; never mutates the host DOM. */
import React from 'react';
export declare const name = "dsh-node-flow-ui";
export declare const inject: readonly ["slots", "layout", "locale"];
interface ClientContext {
    effect: (factory: () => (() => void)) => unknown;
    slots: {
        inject: (name: string, factory: () => (() => void)) => unknown;
        register: (options: Record<string, unknown>, component: React.ComponentType) => (() => void);
    };
    layout: {
        selectPanel: (id: string | null) => void;
    };
    locale: {
        register: (namespace: string, dictionaries: Record<string, unknown>) => (() => void);
        bind: (namespace: string) => (key: string) => string;
    };
}
export declare function apply(ctx: ClientContext): void;
export {};
