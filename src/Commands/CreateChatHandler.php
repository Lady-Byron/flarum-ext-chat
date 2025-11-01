<?php

namespace Xelson\Chat\Commands;

use Carbon\Carbon;
use Illuminate\Contracts\Bus\Dispatcher as BusDispatcher;
use Illuminate\Contracts\Events\Dispatcher;
use Illuminate\Support\Arr;
use Xelson\Chat\Chat;
use Xelson\Chat\ChatUser;
use Xelson\Chat\ChatValidator;
use Xelson\Chat\ChatRepository;
use Xelson\Chat\EventMessageChatCreated;
use Xelson\Chat\Commands\PostEventMessage;
use Xelson\Chat\Event\Chat\Saved;
use Xelson\Chat\Exceptions\ChatEditException;

class CreateChatHandler
{
    protected ChatValidator $validator;
    protected ChatRepository $chats;
    protected BusDispatcher $bus;
    protected Dispatcher $events;

    public function __construct(ChatValidator $validator, ChatRepository $chats, BusDispatcher $bus, Dispatcher $events)
    {
        $this->validator = $validator;
        $this->chats     = $chats;
        $this->bus       = $bus;
        $this->events    = $events;
    }

    /**
     * @param CreateChat $command
     * @return Chat
     */
    public function handle(CreateChat $command)
    {
        $actor      = $command->actor;
        $data       = $command->data;
        $users      = Arr::get($data, 'relationships.users.data', []);
        $attributes = Arr::get($data, 'attributes', []);
        $ip_address = $command->ip_address;

        // ORIGINAL ISSUE: 直接 intval($attributes['isChannel'])，在缺省时会触发 Notice。
        // FIX: 使用 Arr::get 提供默认值 0。
        $isChannel = (int) Arr::get($attributes, 'isChannel', 0);

        $actor->assertCan($isChannel ? 'xelson-chat.permissions.create.channel' : 'xelson-chat.permissions.create');

        $invited = [];
        foreach ($users as $key => $user) {
            if (array_key_exists($user['id'], $invited)) {
                throw new ChatEditException;
            }
            $invited[$user['id']] = true;

            // 自己不计入“外部用户”，稍后统一 push
            if ((int) $user['id'] === (int) $actor->id) {
                array_splice($users, $key, 1);
            }
        }
        $users[] = ['id' => $actor->id, 'type' => 'users'];

        if (!$isChannel && count($users) < 2) {
            throw new ChatEditException;
        }

        if (count($users) === 2) {
            // ORIGINAL ISSUE: 这里用 ->toArray() 提供给 whereIn，得到的是二维数组 [ ['chat_id'=>1], ... ]，导致 whereIn 失效。
            // FIX: 使用 pluck('chat_id')->all() 得到一维数组 [1,2,...]。
            $chatIds = ChatUser::where('user_id', $actor->id)->pluck('chat_id')->all();

            $chats = $this->chats->query()
                ->where('type', 0)
                ->whereIn('id', $chatIds)
                ->with('users')
                ->get();

            foreach ($chats as $chat) {
                $chatUsers = $chat->users;

                if (
                    count($chatUsers) == 2 &&
                    ($chatUsers[0]->id == $users[0]['id'] || $chatUsers[0]->id == $users[1]['id']) &&
                    ($chatUsers[1]->id == $users[0]['id'] || $chatUsers[1]->id == $users[1]['id'])
                ) {
                    // 已存在一对一会话时禁止重复创建
                    throw new ChatEditException;
                }
            }
        }

        $now   = Carbon::now();
        $color = Arr::get($data, 'attributes.color', sprintf('#%06X', mt_rand(0x222222, 0xFFFF00)));
        $icon  = Arr::get($data, 'attributes.icon', '');

        $chat = Chat::build(
            $attributes['title'],
            $color,
            $icon,
            $isChannel,
            $actor->id,
            Carbon::now()
        );

        $this->validator->assertValid($chat->getDirty());
        $chat->save();

        $user_ids = [];

        if (!$isChannel) {
            foreach ($users as $user) {
                if ((int) $user['id'] !== (int) $actor->id) {
                    $user_ids[] = (int) $user['id'];
                }
            }

            $pairs = [];
            foreach (array_merge($user_ids, [$actor->id]) as $v) {
                $pairs[$v] = ['joined_at' => $now];
                if ((int) $v === (int) $actor->id) {
                    $pairs[$v]['role'] = 2;
                }
            }

            try {
                $chat->users()->sync($pairs);
            } catch (\Exception $e) {
                $chat->delete();
                throw $e;
            }
        } else {
            try {
                $chat->users()->sync([$actor->id => ['role' => 2, 'joined_at' => $now]]);
            } catch (\Exception $e) {
                $chat->delete();
                throw $e;
            }
        }

        $eventMessage = $this->bus->dispatch(
            new PostEventMessage($chat->id, $actor, new EventMessageChatCreated($user_ids), $ip_address)
        );

        $this->events->dispatch(
            new Saved($chat, $actor, $data, true)
        );

        return $chat;
    }
}

