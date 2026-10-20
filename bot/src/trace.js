// What happens WHILE a skill runs, at the finest level we can observe:
//   events    damage (with its cause), healing, death, respawn, pickups, teleports and server
//             corrections, kicks, weather changes, pathfinder activity, tick-rate changes
//   body      every physics tick (20/s): position, look, velocity, on ground, and the CONTROL
//             KEYS held (forward, back, left, right, jump, sprint, sneak). Movement is computed by
//             the client and only positions reach the server, so the keys are read from the bot.
//   actions   the action packets the bot sent: dig start/stop, place, use item, hotbar slot,
//             window clicks, attack/interact, sprint/sneak (what the server actually received)
//   blocks    every block change within 16 blocks (from, to): effects of the skill and of the world
//   entities  nearby entities every 5 ticks (about 4 times a second), with stable ids
// Time series are stored as columns: { fields: [...], rows: [[...], ...] } (names are not repeated).
// Shape documented in docs/journal.md.

const BLOCK_RADIUS = 16;
const ENTITY_RADIUS = 16;
const MAX_ENTITIES = 20;
const ENTITY_EVERY = 5; // physics ticks between two entity samples
const CAPS = {
    events: 500,
    body: 2400,
    actions: 1000,
    blocks: 2000,
    entities: 6000,
}; // beyond: truncated

const CONTROLS = [
    "forward",
    "back",
    "left",
    "right",
    "jump",
    "sprint",
    "sneak",
]; // bit 0 = forward...
const TELEPORT_DISTANCE = 5; // a server-forced move further than this is a teleport, not a correction

// Action packets sent to the server, and the fields kept for each
const ACTION_PACKETS = {
    block_dig: (p) => ({
        status: p.status,
        location: loc(p.location),
        face: p.face,
    }), // 0 start, 1 cancel, 2 finish
    block_place: (p) => ({
        hand: p.hand,
        location: loc(p.location),
        direction: p.direction,
    }),
    use_item: (p) => ({ hand: p.hand }),
    held_item_slot: (p) => ({ slot: p.slotId }),
    window_click: (p) => ({
        window: p.windowId,
        slot: p.slot,
        button: p.mouseButton,
        mode: p.mode,
    }),
    close_window: (p) => ({ window: p.windowId }),
    use_entity: (p) => ({ target: p.target, mouse: p.mouse }), // mouse 1 = attack
    arm_animation: (p) => ({ hand: p.hand }),
    entity_action: (p) => ({ action: p.actionId }),
    player_input: (p) => ({ inputs: p.inputs }),
};
const loc = (l) => (l ? [l.x, l.y, l.z] : null);

const round = (v, d = 3) =>
    typeof v === "number" ? Math.round(v * 10 ** d) / 10 ** d : v;

// The packets the bot sends are observed by wrapping bot._client.write, once per bot.
// Listeners registered here receive (name, packet).
const packetListeners = new WeakMap();
function watchOutgoingPackets(bot) {
    if (packetListeners.has(bot)) return packetListeners.get(bot);
    const listeners = new Set();
    packetListeners.set(bot, listeners);
    const write = bot._client.write.bind(bot._client);
    bot._client.write = (name, packet) => {
        for (const fn of listeners) fn(name, packet);
        return write(name, packet);
    };
    return listeners;
}

function series(fields) {
    return { fields, rows: [] };
}

// Start recording; returns stop(), which returns the trace. Body every physics tick (20/s),
// entities every ENTITY_EVERY ticks.
function startTrace(bot) {
    const start = Date.now();
    const ms = () => Date.now() - start;
    const trace = {
        events: [],
        body: series([
            "ms",
            "x",
            "y",
            "z",
            "yaw",
            "pitch",
            "vx",
            "vy",
            "vz",
            "on_ground",
            "controls",
        ]),
        actions: [],
        blocks: series(["ms", "x", "y", "z", "from", "to"]),
        entities: series(["ms", "id", "name", "x", "y", "z"]),
    };
    const truncated = new Set();
    const add = (key, list, item) => {
        if (list.length >= CAPS[key]) {
            truncated.add(key);
            return;
        }
        list.push(item);
    };
    const event = (type, data = {}) =>
        add("events", trace.events, {
            ms: ms(),
            tick: bot.time?.age ?? null,
            type,
            ...data,
        });

    let lastHealth = bot.health;
    let physicsTicks = 0;
    const listeners = [
        // --- Events
        [
            bot._client,
            "damage_event",
            (p) => {
                if (!bot.entity || p.entityId !== bot.entity.id) return;
                const source = bot.entities[p.sourceCauseId - 1];
                event("damage", {
                    damage_type_id: p.sourceTypeId,
                    source: source ? source.name || source.type : null,
                });
            },
        ],
        [
            bot,
            "health",
            () => {
                const delta = bot.health - lastHealth;
                if (delta < 0)
                    event("health_loss", {
                        amount: round(-delta),
                        health: round(bot.health),
                    });
                if (delta > 0)
                    event("heal", {
                        amount: round(delta),
                        health: round(bot.health),
                    });
                lastHealth = bot.health;
            },
        ],
        [bot, "death", () => event("death")],
        [bot, "respawn", () => event("respawn")],
        // The server moved the bot: far = a teleport (/tp, respawn...), close = a correction (the
        // server refused a move; many of them in a row = the bot is stuck, see fixWallContact)
        [
            bot,
            "forcedMove",
            () => {
                const p = bot.entity.position;
                const last = trace.body.rows.at(-1);
                const jump = last
                    ? Math.hypot(p.x - last[1], p.y - last[2], p.z - last[3])
                    : null;
                if (jump === null || jump > TELEPORT_DISTANCE) {
                    event("teleport", {
                        distance: jump === null ? null : round(jump, 2),
                    });
                } else {
                    event("correction", { distance: round(jump, 2) });
                }
            },
        ],
        [
            bot,
            "weatherUpdate",
            () =>
                event("weather", {
                    raining: !!bot.isRaining,
                    rain_level: round(bot.rainState, 2),
                    thunder: round(bot.thunderState, 2),
                }),
        ],
        [
            bot,
            "playerCollect",
            (collector, collected) => {
                if (collector !== bot.entity) return;
                const item = collected.getDroppedItem
                    ? collected.getDroppedItem()
                    : null;
                event("pickup", {
                    item: item ? item.name : null,
                    count: item ? item.count : null,
                });
            },
        ],
        [
            bot,
            "kicked",
            (reason) =>
                event("kicked", { reason: String(reason).slice(0, 200) }),
        ],
        [bot, "end", () => event("disconnected")],
        [
            bot,
            "path_update",
            (r) =>
                event("path_update", {
                    status: r.status,
                    length: r.path.length,
                    visited: r.visitedNodes,
                }),
        ],
        [bot, "path_reset", (reason) => event("path_reset", { reason })],
        [bot, "goal_reached", () => event("goal_reached")],
        [
            bot._client,
            "set_ticking_state",
            (p) =>
                event("tick_rate", {
                    tick_rate: p.tick_rate,
                    frozen: p.is_frozen,
                }),
        ],
        // --- Body and keys every physics tick; nearby entities every ENTITY_EVERY ticks
        [
            bot,
            "physicsTick",
            () => {
                const e = bot.entity;
                if (!e) return;
                let controls = 0;
                CONTROLS.forEach((c, i) => {
                    if (bot.controlState && bot.controlState[c])
                        controls |= 1 << i;
                });
                const p = e.position;
                const v = e.velocity;
                const tick = physicsTicks++;
                add("body", trace.body.rows, [
                    ms(),
                    round(p.x),
                    round(p.y),
                    round(p.z),
                    round(e.yaw),
                    round(e.pitch),
                    round(v.x),
                    round(v.y),
                    round(v.z),
                    e.onGround ? 1 : 0,
                    controls,
                ]);
                if (tick % ENTITY_EVERY !== 0) return;
                const near = Object.values(bot.entities)
                    .filter(
                        (x) =>
                            x !== e &&
                            x.position &&
                            x.position.distanceTo(p) <= ENTITY_RADIUS,
                    )
                    .sort(
                        (a, b) =>
                            a.position.distanceTo(p) - b.position.distanceTo(p),
                    )
                    .slice(0, MAX_ENTITIES);
                for (const x of near) {
                    add("entities", trace.entities.rows, [
                        ms(),
                        x.id,
                        x.name || x.type,
                        round(x.position.x, 2),
                        round(x.position.y, 2),
                        round(x.position.z, 2),
                    ]);
                }
            },
        ],
        // --- Block changes near the bot
        [
            bot,
            "blockUpdate",
            (oldBlock, newBlock) => {
                if (
                    !oldBlock ||
                    !newBlock ||
                    oldBlock.type === newBlock.type ||
                    !bot.entity
                )
                    return;
                const b = newBlock.position;
                if (b.distanceTo(bot.entity.position) > BLOCK_RADIUS) return;
                add("blocks", trace.blocks.rows, [
                    ms(),
                    b.x,
                    b.y,
                    b.z,
                    oldBlock.name,
                    newBlock.name,
                ]);
            },
        ],
    ];
    for (const [emitter, name, fn] of listeners)
        if (emitter) emitter.on(name, fn);

    // --- Action packets
    const packets =
        bot._client && typeof bot._client.write === "function"
            ? watchOutgoingPackets(bot)
            : null;
    const onPacket = (name, packet) => {
        const keep = ACTION_PACKETS[name];
        if (keep)
            add("actions", trace.actions, {
                ms: ms(),
                packet: name,
                ...keep(packet),
            });
    };
    if (packets) packets.add(onPacket);

    return function stop() {
        for (const [emitter, name, fn] of listeners)
            if (emitter) emitter.removeListener(name, fn);
        if (packets) packets.delete(onPacket);
        return { ...trace, truncated: [...truncated] };
    };
}

// What the brain is told about a trace: damage taken and death (the journal keeps the full trace)
function summarizeForBrain(trace) {
    const events = trace ? trace.events : [];
    const damage = events
        .filter((e) => e.type === "health_loss")
        .reduce((n, e) => n + e.amount, 0);
    return {
        damage_taken: round(damage, 1),
        died: events.some((e) => e.type === "death"),
    };
}

export { CONTROLS, startTrace, summarizeForBrain };
