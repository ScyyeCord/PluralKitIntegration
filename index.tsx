/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { addMessagePreEditListener, removeMessagePreEditListener } from "@api/MessageEvents";
import { addMessagePopoverButton, removeMessagePopoverButton } from "@api/MessagePopover";
import { definePluginSettings } from "@api/Settings";
import { DeleteIcon } from "@components/Icons";
import definePlugin, { OptionType, StartAt } from "@utils/types";
import {
    Button,
    ChannelStore,
    MessageActions,
    MessageStore, Toasts, UserStore
} from "@webpack/common";
import { Message } from "discord-types/general";

import {
    deleteMessage,
    getAuthorOfMessage,
    isOwnPkMessage,
    isPk,
    loadAuthors, loadData,
    replaceTags,
} from "./utils";
import { copyWithToast } from "@utils/misc";

const EditIcon = () => {
    return <svg role={"img"} width={"16"} height={"16"} fill={"none"} viewBox={"0 0 24 24"}>
        <path fill={"currentColor"} d={"m13.96 5.46 4.58 4.58a1 1 0 0 0 1.42 0l1.38-1.38a2 2 0 0 0 0-2.82l-3.18-3.18a2 2 0 0 0-2.82 0l-1.38 1.38a1 1 0 0 0 0 1.42ZM2.11 20.16l.73-4.22a3 3 0 0 1 .83-1.61l7.87-7.87a1 1 0 0 1 1.42 0l4.58 4.58a1 1 0 0 1 0 1.42l-7.87 7.87a3 3 0 0 1-1.6.83l-4.23.73a1.5 1.5 0 0 1-1.73-1.73Z"}></path>
    </svg>;
};

export const settings = definePluginSettings({
    colorNames: {
        type: OptionType.BOOLEAN,
        description: "Display member colors in their names in chat",
        default: false
    },
    displayOther: {
        type: OptionType.STRING,
        description: "How to display proxied users (from other systems) in chat\n" +
            "{tag}, {name}, {memberId}, {pronouns}, {systemId}, {systemName}, {color}, {avatar}, {messageCount}, {systemMessageCount} are valid variables (All lowercase)",
        default: "{name}{tag}",
    },
    displayLocal: {
        type: OptionType.STRING,
        description: "How to display proxied users (from your system, defaults to displayOther if blank) in chat\n" +
            "{tag}, {name}, {memberId}, {pronouns}, {systemId}, {systemName}, {color}, {avatar}, {messageCount}, {systemMessageCount} are valid variables (All lowercase)",
        default: "",
    },
    editMessageChannel: {
        type: OptionType.STRING,
        description: "Channel ID to send pk;edit messages to",
        default: undefined,
    },
    load: {
        type: OptionType.COMPONENT,
        component: () => {
            return <Button label={"Load"} onClick = {async () => {
                await loadData().then(value => {
                    Toasts.show({
                        message: "Loaded data successfully!",
                        id: Toasts.genId(),
                        type: Toasts.Type.SUCCESS
                    });
                });
            }}>LOAD</Button>;
        },
        description: "Load local system into memory"
    },
    printData: {
        type: OptionType.COMPONENT,
        component: () => {
            return <Button onClick = {() => {
                console.log(settings.store.data);
            }}>Print Data</Button>;
        },
        description: "Print stored data to console",
        hidden: IS_DEV // showDebug
    },
    data: {
        type: OptionType.STRING,
        description: "Datastore",
        default: "{}",
        hidden: IS_DEV // showDebug
    }
});

export default definePlugin({
    name: "Plural Kit",
    description: "Pluralkit integration for Vencord",
    authors: [{
        name: "Scyye",
        id: 553652308295155723n
    }],
    startAt: StartAt.WebpackReady,
    settings,
    patches: [
        {
            find: '?"@":"")',
            replacement: [
                {
                    match: /(?<=onContextMenu:\i,children:).*?\)}/,
                    replace: "$self.renderUsername(arguments[0])}"
                },
                {
                    match: /Vencord.Plugins.plugins\["ShowMeYourName"]\.renderUsername\(arguments\[0]\)/,
                    replace: "$self.renderUsername(arguments[0])}"
                }
            ]
        },
        // make up arrow to edit most recent message work
        // this might conflict with messageLogger, but to be honest, if you're
        // using that plugin, you'll have enough problems with pk already
        // Stolen directly from https://github.com/lynxize/vencord-plugins/blob/plugins/src/userplugins/pk4vc/index.tsx
        {
            find: "getLastEditableMessage",
            replacement: {
                match: /return (.)\(\)\(this.getMessages\((.)\).{10,100}:.\.id\)/,
                replace: "return $1()(this.getMessages($2).toArray()).reverse().find(msg=>$self.isOwnMessage(msg)"
            }
        },
    ],

    isOwnMessage: (message: Message) => isOwnPkMessage(message) || message.author.id === UserStore.getCurrentUser().id,

    renderUsername: ({ author, message, isRepliedMessage, withMentionPrefix }) => {

        const prefix = isRepliedMessage && withMentionPrefix ? "@" : "";
        const discordUsername = author.nick??author.displayName??author.username;
        if (!isPk(message)) {
            return <>{prefix}{discordUsername}</>;
        }


        let color: string = "666666";
        const pkAuthor = getAuthorOfMessage(message);

        if (pkAuthor.member && settings.store.colorNames) {
            color = pkAuthor.member.color??color;
        }

        const display = isOwnPkMessage(message) && settings.store.displayLocal !== "" ? settings.store.displayLocal : settings.store.displayOther;
        const resultText = replaceTags(display, message, settings.store.data);

        return <span style={{
            color: `#${color}`,
        }}>{resultText}</span>;
    },

    async start() {
        await loadData();
        if (settings.store.data === "{}")
            await loadAuthors();

        addMessagePopoverButton("pk-edit", msg => {
            if (!msg) return null;
            if (!isOwnPkMessage(msg)) return null;

            return {
                label: "Edit",
                icon: () => {
                    return <EditIcon/>;
                },
                message: msg,
                channel: ChannelStore.getChannel(msg.channel_id),
                onClick: () => MessageActions.startEditMessage(msg.channel_id, msg.id, msg.content),
                onContextMenu: _ => {}
            };
        });

        addMessagePopoverButton("pk-delete", msg => {
            if (!msg) return null;
            if (!isOwnPkMessage(msg)) return null;

            return {
                label: "Delete",
                icon: () => {
                    return <DeleteIcon/>;
                },
                message: msg,
                channel: ChannelStore.getChannel(msg.channel_id),
                onClick: () => deleteMessage(msg),
                onContextMenu: _ => {}
            };
        });

        // Stolen directly from https://github.com/lynxize/vencord-plugins/blob/plugins/src/userplugins/pk4vc/index.tsx
        this.preEditListener = addMessagePreEditListener((channelId, messageId, messageObj) => {
            if (isPk(MessageStore.getMessage(channelId, messageId))) {
                const { guild_id } = ChannelStore.getChannel(channelId);
                MessageActions.sendMessage(settings.store.editMessageChannel??channelId, {
                    reaction: false,
                    content: "pk;e https://discord.com/channels/" + guild_id + "/" + channelId + "/" + messageId + " " + messageObj.content
                });
                MessageActions.endEditMessage(channelId, messageId, "");
                return { cancel: true };
            }
        });
    },
    stop() {
        removeMessagePopoverButton("pk-edit");
        removeMessagePopoverButton("pk-delete");
        removeMessagePreEditListener(this.preEditListener)
    },
});


