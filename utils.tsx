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

export function replaceTags(content: string, message: Message, localSystemData: string) {
    const author = getAuthorOfMessage(message);
    const localSystem: Author[] = JSON.parse(localSystemData);

    const systemSettings: SystemGuildSettings = author.systemSettings[ChannelStore.getChannel(message.channel_id).guild_id];
    const memberSettings: MemberGuildSettings = author.guildSettings[ChannelStore.getChannel(message.channel_id).guild_id];
    const { system } = author;

    // prioritize guild settings, then system/member settings
    const { tag } = systemSettings??system;
    const name = memberSettings ? memberSettings.display_name ?? (author.member.display_name??author.member.name)  : (author.member.display_name??author.member.name)
    const avatar = memberSettings ? memberSettings.avatar_url ?? "" : (author.member.avatar_url ?? author.member.webhook_avatar_url ?? author.system.avatar_url ?? "");

    return content
        .replace(/{tag}/g, tag??"")
        .replace(/{name}/g, name??"")
        .replace(/{memberid}/g, author.member.id??"")
        .replace(/{pronouns}/g, author.member.pronouns??"")
        .replace(/{systemid}/g, author.system.id??"")
        .replace(/{systemname}/g, author.system.name??"")
        .replace(/{color}/g, author.member.color??"ffffff")
        .replace(/{avatar}/g, avatar??"")
        .replace(/{messagecount}/g, author.messageIds.length.toString()??"")
        .replace(/{systemmessagecount}/g, localSystem.map(author => author.messageIds.length).reduce((acc, val) => acc + val).toString());
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

    (await getMembers(system.id)).forEach((member: Member) => {
        localSystem.push({
            messageIds: [],
            member,
            system,
            guildSettings: new Map(),
            systemSettings: new Map()
        });
    });

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

export function getAuthorOfMessage(message: Message) {
    const authorData = generateAuthorData(message);
    let author: Author = authors[authorData]??undefined;

    if (author) {
        author.messageIds.push(message.id);
        authors[authorData] = author;
        DataStore.set(DATASTORE_KEY, authors);
        return author;
    }

    getMessage(message.id).then((msg: PKMessage) => {
        author = ({ messageIds: [msg.id], member: msg.member as Member, system: msg.system as System, systemSettings: new Map(), guildSettings: new Map() });
        getMemberGuildSettings(author.member.id, ChannelStore.getChannel(msg.channel).guild_id).then(guildSettings => {
            author.guildSettings?.set(ChannelStore.getChannel(msg.channel).guild_id, guildSettings);
        });

        getSystemGuildSettings(author.system.id, ChannelStore.getChannel(msg.channel).guild_id).then(guildSettings => {
            author.systemSettings?.set(ChannelStore.getChannel(msg.channel).guild_id, guildSettings);
        });

        authors[authorData] = author;
        DataStore.set(DATASTORE_KEY, authors);
    });

    return authors[authorData];
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
