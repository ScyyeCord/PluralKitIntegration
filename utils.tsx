/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { findByCode } from "@webpack";
import { ChannelStore, FluxDispatcher, UserStore } from "@webpack/common";
import { Message } from "discord-types/general";

import { settings } from "./index";
import {
    Member,
    MemberGuildSettings, PKMessage,
    System,
    SystemGuildSettings
} from "./PluralKitApi";


// I dont fully understand how to use datastores, if I used anything incorrectly please let me know
export const DATASTORE_KEY = "pk";
export let authors: Record<string, Author> = {};

export let localSystemNames: string[] = [];
export let localSystemJson: string = "";
export let localSystem: Author[] = [];

export const authorCache = new Map<string, Author>();

export interface Author {
    messageIds: string[];
    member: Member;
    system: System;
    guildSettings: Map<string, MemberGuildSettings>;
    systemSettings: Map<string, SystemGuildSettings>;
}

export function isPk(msg: Message): boolean {
    return msg?.applicationId === "466378653216014359";
}

export function isOwnPkMessage(message: Message): boolean {
    if (!isPk(message) || ["[]", "{}", undefined].includes(localSystemJson)) return false;

    const authorId = getAuthorOfMessage(message).member.id;
    return (localSystem).some(author => author.member.id === authorId);
}

// TODO: possibly better to do .replaceAll() instead of .replace() for multiple replacements
export function replaceTags(content: string, message: Message, localSystemData: string) {
    const author = getAuthorOfMessage(message);
    if (!author) return "Unknown author";
    const localSystem: Author[] = JSON.parse(localSystemData);

    const { guild_id } = ChannelStore.getChannel(message.channel_id);
    const systemSettings = author.systemSettings?.[guild_id] ?? {};
    const memberSettings = author.guildSettings?.[guild_id] ?? {};
    const { system, member } = author;

    const replacements = {
        "{tag}": systemSettings.tag ?? system.tag ?? "",
        "{name}": memberSettings.display_name ?? member.display_name ?? member.name ?? "",
        "{memberid}": member.id ?? "",
        "{pronouns}": member.pronouns ?? "",
        "{systemid}": system.id ?? "",
        "{systemname}": system.name ?? "",
        "{color}": member.color ?? "ffffff",
        "{avatar}": memberSettings.avatar_url ?? member.avatar_url ?? member.webhook_avatar_url ?? system.avatar_url ?? "",
        "{messagecount}": author.messageIds.length.toString(),
        "{systemmessagecount}": localSystem.reduce((acc, { messageIds }) => acc + messageIds.length, 0).toString()
    };

    return content.replace(/{tag}|{name}|{memberid}|{pronouns}|{systemid}|{systemname}|{color}|{avatar}|{messagecount}|{systemmessagecount}/g, match => replacements[match]);
}

export async function loadAuthors() {
    authors = await DataStore.get<Record<string, Author>>(DATASTORE_KEY) ?? {};
    localSystem = JSON.parse(localSystemJson = settings.store.data) ?? {};
    localSystemNames = localSystem.map(author => author.member.display_name??author.member.name);
}

export async function loadData() {
    const system = await getSystem(UserStore.getCurrentUser().id);
    if (!system) {
        settings.store.data = "{}";
        return;
    }
    const localSystem: Author[] = [];

    const members = await getMembers(system.id);
    await Promise.all(members.map(async (member: Member) => {
        const author: Author = {
            messageIds: [],
            member,
            system,
            guildSettings: new Map(),
            systemSettings: new Map()
        };
        localSystem.push(author);
    }));

    settings.store.data = JSON.stringify(localSystem);
    await loadAuthors();
}

export function replyToMessage(msg: Message, mention: boolean, hideMention: boolean, content?: string | undefined) {
    FluxDispatcher.dispatch({
        type: "CREATE_PENDING_REPLY",
        channel: ChannelStore.getChannel(msg.channel_id),
        message: msg,
        shouldMention: mention,
        showMentionToggle: !hideMention,
    });
    if (content) {
        insertTextIntoChatInputBox(content);
    }
}

export function deleteMessage(msg: Message) {
    const { addReaction } = findByCode(".userHasReactedWithEmoji");

    addReaction(msg.channel_id, msg.id, { name: "❌" });
}

export function generateAuthorData(message: Message) {
    return `${message.author.username}##${message.author.avatar}`;
}

export function getAuthorOfMessage(message: Message): Author {
    const authorData = generateAuthorData(message);
    if (authorCache.has(authorData)) {
        return authorCache.get(authorData)??{} as Author;
    }

    let author: Author = authors[authorData] ?? undefined;
    if (author) {
        author.messageIds.push(message.id);
        authors[authorData] = author;
        DataStore.set(DATASTORE_KEY, authors);
        authorCache.set(authorData, author);
        return author;
    }

    getMessage(message.id).then((msg: PKMessage) => {
        author = {
            messageIds: [msg.id],
            member: msg.member as Member,
            system: msg.system as System,
            systemSettings: new Map(),
            guildSettings: new Map()
        };
        getMemberGuildSettings(author.member.id, ChannelStore.getChannel(msg.channel).guild_id).then(guildSettings => {
            author.guildSettings?.set(ChannelStore.getChannel(msg.channel).guild_id, guildSettings);
        });

        getSystemGuildSettings(author.system.id, ChannelStore.getChannel(msg.channel).guild_id).then(guildSettings => {
            author.systemSettings?.set(ChannelStore.getChannel(msg.channel).guild_id, guildSettings);
        });

        authors[authorData] = author;
        DataStore.set(DATASTORE_KEY, authors);
        authorCache.set(authorData, author);
    });

    return authors[authorData]??{} as Author;
}

const API_URL = "https://api.pluralkit.me/v2/";
const API_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Scyye Vencord/1.0 (contact @scyye on Discord for any issues)"
}
async function request<T>(endpoint: string) {
    return fetch(API_URL + endpoint, {
        method:"GET",
        headers: API_HEADERS,
    }).then(res => res.json() as T);
}

export async function getSystem(id: string) {
    return await request<System>(`systems/${id}`);
}

export async function getMessage(id: string) {
    return await request<PKMessage>(`messages/${id}`);
}

export async function getSystemGuildSettings(system: string, guild: string) {
    return await request<SystemGuildSettings>(`systems/${system}/guilds/${guild}`);
}

export async function getMembers(system: string) {
    return await request<Member[]>(`systems/${system}/members`);
}

export async function getMember(member: string) {
    return await request<Member>(`members/${member}`);
}

export async function getMemberGuildSettings(member: string, guild: string) {
    return await request<MemberGuildSettings>(`members/${member}/guilds/${guild}`);
}
