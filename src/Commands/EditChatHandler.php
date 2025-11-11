<?php
/*
 * This file is part of xelson/flarum-ext-chat
 */

namespace Xelson\Chat\Commands;

use Carbon\Carbon;
use Illuminate\Support\Arr;
use Xelson\Chat\ChatValidator;
use Xelson\Chat\ChatRepository;
use Xelson\Chat\EventMessageChatEdited;
use Xelson\Chat\EventMessageChatAddRemoveUser;
use Xelson\Chat\Commands\PostEventMessage;
use Xelson\Chat\Exceptions\ChatEditException;
use Illuminate\Contracts\Bus\Dispatcher as BusDispatcher;
use Illuminate\Contracts\Events\Dispatcher;
use Xelson\Chat\Event\Chat\Saved;

class EditChatHandler
{
    protected $validator;
    protected $chats;
    protected $bus;
    protected $events;

    public function __construct(ChatValidator $validator, ChatRepository $chats, BusDispatcher $bus, Dispatcher $events)
    {
        $this->validator = $validator;
        $this->chats     = $chats;
        $this->bus       = $bus;
        $this->events    = $events;
    }

    public function handle(EditChat $command)
    {
        $chat_id   = $command->chat_id;
        $actor     = $command->actor;
        $data      = $command->data;
        $attributes= Arr::get($data, 'attributes', []);
        $ip_address= $command->ip_address;

        $chat = $this->chats->findOrFail($chat_id, $actor);

        $all_users = $chat->users()->get();
        $all_ids   = [];
        $current_ids = [];
        $usersMap  = [];

        foreach ($all_users as $u) {
            $all_ids[] = $u->id;
            $usersMap[$u->id] = $u;
            if (!$u->pivot->removed_at) {
                $current_ids[] = $u->id;
            }
        }

        $now       = Carbon::now();
        $isCreator = $actor->id == $chat->creator_id || (!$chat->creator_id && $actor->isAdmin());
        $isPM      = count($all_users) <= 2 && $chat->type == 0;
        $isChannel = $chat->type == 1;

        $actorInChat = in_array($actor->id, $all_ids);
        $localUser   = $actorInChat ? $usersMap[$actor->id] : null;

        $editable_columns = ['title', 'icon', 'color'];
        $events_list = [];
        $attrsChanged = false;

        // ===== A) 特例：公共频道“首次加入”放行 =====
        // 如果用户还不是成员，但这次请求仅仅是把自己加入公共频道，就允许。
        $added   = Arr::get($data, 'attributes.users.added', []);
        $removed = Arr::get($data, 'attributes.users.removed', []);
        $edited  = Arr::get($data, 'attributes.users.edited',  []);

        $added_ids = [];
        $removed_ids = [];
        if ($added)   foreach ($added as $u)   $added_ids[] = $u['id'];
        if ($removed) foreach ($removed as $u) $removed_ids[] = $u['id'];

        $added_ids   = array_unique($added_ids);
        $removed_ids = array_unique($removed_ids);

        if (!$actorInChat && $isChannel) {
            $isSelfJoinOnly = (count($added_ids) === 1 && $added_ids[0] == $actor->id) && empty($removed_ids) && empty($edited);
            if ($isSelfJoinOnly) {
                $chat->users()->syncWithoutDetaching([
                    $actor->id => [
                        'role'       => 0,
                        'joined_at'  => $now,
                        'readed_at'  => $now,
                        'removed_by' => null,
                        'removed_at' => null,
                    ],
                ]);
                // 公共频道不发“加人事件消息”（延续原实现）
                $this->events->dispatch(new Saved($chat, $actor, $data, false));
                return $chat->fresh(); // 返回最新 pivot
            }
        }

        // ===== B) 常规权限门禁（非公共频道首次加入）=====
        // 必须是“这个会话的参与者（含离开但仍有 pivot）”：
        $actor->assertPermission($actorInChat);

        // 若被踢（removed_by != actor），不允许进行任何编辑
        $actor->assertPermission(!$localUser->pivot->removed_at || $localUser->pivot->removed_by == $actor->id);

        // ===== C) 编辑标题/图标/颜色 =====
        foreach ($editable_columns as $column) {
            if (Arr::get($data, 'attributes.' . $column, 0) && $chat[$column] != $attributes[$column]) {
                // 元信息：仅频道或非 PM 可改
                $actor->assertPermission($isChannel || !$isPM);
                // 需要“会话内角色”或创作者
                $actor->assertPermission($localUser->pivot->role || $isCreator);

                $message = $this->bus->dispatch(
                    new PostEventMessage($chat->id, $actor, new EventMessageChatEdited($column, $chat[$column], $attributes[$column]), $ip_address)
                );
                $events_list[] = $message->id;
                $chat[$column] = $attributes[$column];
                $attrsChanged = true;
            }
        }

        // ===== D) 增删成员 =====
        if (count(array_intersect($added_ids, $removed_ids))) {
            throw new ChatEditException('Trying to add and remove users in the same time');
        }
        if (count($added_ids) && count(array_intersect($added_ids, $current_ids))) {
            throw new ChatEditException(sprintf('Cannot add new users: one of them already in chat (%s and %s)', json_encode($added_ids), json_encode($current_ids)));
        }
        if (count($removed_ids) && !count(array_intersect($removed_ids, $current_ids))) {
            throw new ChatEditException('Cannot kick users: one of them already kicked');
        }

        // PM 房间限制：至多只改动一个人，且只能操作自己
        if ($isPM && (count($added_ids) > 1 || count($removed_ids) > 1 || (count($added_ids) && $added_ids[0] != $actor->id) || (count($removed_ids) && $removed_ids[0] != $actor->id))) {
            throw new ChatEditException('Invalid user array for PM chat room');
        }

        if (count($added_ids) || count($removed_ids)) {
            $added_pairs = [];
            $removed_pairs = [];

            foreach ($added_ids as $v) {
                $added_pairs[$v] = ['removed_at' => null, 'removed_by' => null];
            }

            foreach ($removed_ids as $v) {
                // 移除：只能移除自己，或角色级别更低者，或创作者
                $actor->assertPermission(
                    $v == $actor->id || ($usersMap[$v]->pivot->role ?? -1) < $localUser->pivot->role || $isCreator
                );
                $removed_pairs[$v] = ['removed_at' => $now, 'removed_by' => $actor->id];
            }

            $chat->users()->syncWithoutDetaching($added_pairs + $removed_pairs);

            // 频道不发送“成员增删”事件消息；非频道保持原行为
            if (!$isChannel) {
                $message = $this->bus->dispatch(
                    new PostEventMessage($chat->id, $actor, new EventMessageChatAddRemoveUser($added_ids, $removed_ids), $ip_address)
                );
                $events_list[] = $message->id;
            }
        }

        // ===== E) 角色变更 =====
        $roles_updated_for = [];
        $edited = Arr::get($data, 'attributes.users.edited', 0);
        if ($edited) {
            // 仅非 PM 且创作者可改他人角色
            $actor->assertPermission(!$isPM && $isCreator);

            $syncUsers = [];

            foreach ($edited as $user) {
                $id = $user['id'];
                $role = $user['role'];

                if (array_search($id, $all_ids) === false) continue;
                if ($id == $actor->id) throw new ChatEditException('Сannot set a role for yourself');
                if (!in_array($role, [0, 1, 2])) throw new ChatEditException('Unacceptable role');

                $syncUsers[$id] = ['role' => $role];
                if ($role != $usersMap[$id]->pivot->role) $roles_updated_for[] = $id;
            }

            $chat->users()->syncWithoutDetaching($syncUsers);
        }

        // ===== F) 保存与事件 =====
        if ($attrsChanged) {
            $this->validator->assertValid($chat->getDirty());
            $chat->save();
        }

        $chat->eventmsg_range = $events_list;
        $chat->roles_updated_for = $roles_updated_for;

        $this->events->dispatch(new Saved($chat, $actor, $data, false));

        return $chat;
    }
}
