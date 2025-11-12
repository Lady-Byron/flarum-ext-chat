<?php
/*
 * This file is part of xelson/flarum-ext-chat
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
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
// +++ 新增 Import +++
use Flarum\User\Exception\PermissionDeniedException;

class EditChatHandler
{
    /**
     * @param ChatValidator $validator
     * @param ChatRepository $chats
     * @param BusDispatcher $bus
     * @param Dispatcher $events
     */
    public function __construct(ChatValidator $validator, ChatRepository $chats, BusDispatcher $bus, Dispatcher $events)
    {
        $this->validator = $validator;
        $this->chats  = $chats;
        $this->bus = $bus;
        $this->events = $events;
    }

    /**
     * Handles the command execution.
     *
     * @param EditChat $command
     * @return null|string
     */
    public function handle(EditChat $command)
    {
        $chat_id = $command->chat_id;
        $actor = $command->actor;
        $data = $command->data;
        $attributes = Arr::get($data, 'attributes', []);
        $ip_address = $command->ip_address;

        // 1. 使用“宽容”查询找到 Chat (基于批次一，我们确认了 findOrFail 是宽容的)
        $chat = $this->chats->findOrFail($chat_id, $actor);

        // 2. 准备变量
        $all_users = $chat->users()->get();
        $all_ids = [];
        $current_ids = [];
        $users = [];

        foreach ($all_users as $user) {
            $all_ids[] = $user->id;
            $users[$user->id] = $user;
            if (!$user->pivot->removed_at) $current_ids[] = $user->id;
        }

        $editable_colums = ['title', 'icon', 'color'];

        $events_list = [];
        $attrsChanged = false; // 用于检测是否修改了 title/icon/color

        // 3. +++ 新的核心权限逻辑 +++

        // 安全地获取当前 actor 的成员状态 (使用我们在 Chat.php 中添加的新方法)
        $localUserPivot = $chat->getMembership($actor);
        $isMember = $localUserPivot && is_null($localUserPivot->removed_at);

        // 检查用户是否正试图“加入” (add self)
        $added = Arr::get($data, 'attributes.users.added', []);
        $added_ids = $added ? array_column($added, 'id') : [];
        $isTryingToJoin = count($added_ids) === 1 && $added_ids[0] == $actor->id;

        // 检查用户是否在做其他操作
        $removed = Arr::get($data, 'attributes.users.removed', 0);
        $edited = Arr::get($data, 'attributes.users.edited', 0);
        foreach ($editable_colums as $column) {
            if (Arr::has($data, 'attributes.' . $column)) {
                $attrsChanged = true;
                break;
            }
        }
        
        if ($isTryingToJoin) {
            // --- 场景1：用户正在“加入” ---
            if ($isMember) {
                // 不允许“加入”一个已经是成员的聊天
                throw new ChatEditException('Already a member');
            }
            // 检查“加入”时是否在做其他操作
            if ($attrsChanged || $removed || $edited || count($added_ids) > 1) {
                // 不允许在“加入”的同时做其他事
                throw new ChatEditException('Cannot perform other actions while joining');
            }
            // (如果 $isTryingToJoin 为 true 且 $isMember 为 false，且没有其他操作，我们允许请求继续)
        
        } else {
            // --- 场景2：用户在做 *任何其他* 操作 (改标题/踢人/改角色等) ---
            if (!$chat->canAccessContent($actor)) {
                // 必须是管理员或 *活跃* 成员
                throw new PermissionDeniedException();
            }
        }
        // +++ 权限逻辑结束 +++

        // (已删除) 旧的权限检查
        // $actor->assertPermission(
        //     in_array($actor->id, $all_ids)
        // );
        // $localUser = $users[$actor->id]; // $localUserPivot 现在来自 getMembership
        // $actor->assertPermission(
        //     !$localUser->pivot->removed_at || $localUser->pivot->removed_by == $actor->id
        // );


        $now = Carbon::now();
        $isCreator = $actor->id == $chat->creator_id || (!$chat->creator_id && $actor->isAdmin());
        $isPM = count($all_users) <= 2 && $chat->type == 0;
        $isChannel = $chat->type == 1;

        foreach ($editable_colums as $column) {
            // (注意：这里 $attrsChanged 已在上面计算过，但为了原始逻辑不变，我们再次检查)
            if (Arr::has($data, 'attributes.' . $column) && $chat[$column] != $attributes[$column]) {
                $actor->assertPermission(
                    $isChannel || !$isPM
                );

                // 确保 $localUserPivot 存在（因为 $isTryingToJoin=false 时已确保 $isMember=true）
                $actor->assertPermission(
                    $localUserPivot && ($localUserPivot->role || $isCreator)
                );

                $message = $this->bus->dispatch(
                    new PostEventMessage($chat->id, $actor, new EventMessageChatEdited($column, $chat[$column], $attributes[$column]), $ip_address)
                );
                $events_list[] = $message->id;
                $chat[$column] = $attributes[$column];

                $attrsChanged = true; // 再次标记
            }
        }

        // $added 和 $removed 已在顶部定义
        // $added = Arr::get($data, 'attributes.users.added', 0);
        // $removed = Arr::get($data, 'attributes.users.removed', 0);

        if ($added || $removed) {
            // Редактирование списка пользователей:
            // ... (保留俄语注释)

            $added_ids_full = []; // 重新获取，因为上面的 $added_ids 只是 array_column
            $removed_ids_full = [];
            if ($added) foreach ($added as $user) $added_ids_full[] = $user['id'];
            if ($removed) foreach ($removed as $user) $removed_ids_full[] = $user['id'];
            $added_ids_full = array_unique($added_ids_full);
            $removed_ids_full = array_unique($removed_ids_full);

            if (count(array_intersect($added_ids_full, $removed_ids_full)))
                throw new ChatEditException('Trying to add and remove users in the same time');

            // +++ 逻辑修改：如果是“加入”，$isTryingToJoin=true，此检查会通过。
            if (count($added_ids_full) && count(array_intersect($added_ids_full, $current_ids)))
                throw new ChatEditException(sprintf('Cannot add new users: one of them already in chat (%s and %s)', json_encode($added_ids_full), json_encode($current_ids)));

            if (count($removed_ids_full) && !count(array_intersect($removed_ids_full, $current_ids)))
                throw new ChatEditException('Cannot kick users: one of them already kicked');

            // +++ 逻辑修改：如果是“加入”，$isTryingToJoin=true，此检查会跳过
            if (!$isTryingToJoin && $isPM && (count($added_ids_full) > 1 || count($removed_ids_full) > 1 || (count($added_ids_full) && $added_ids_full[0] != $actor->id) || (count($removed_ids_full) && $removed_ids_full[0] != $actor->id)))
                throw new ChatEditException('Invalid user array for PM chat room');

            if (count($added_ids_full) || count($removed_ids_full)) {
                $added_pairs = [];
                $removed_pairs = [];

                foreach ($added_ids_full as $v)
                    // +++ 关键：设置 'joined_at' 和 'readed_at' 确保新成员状态正确
                    $added_pairs[$v] = ['joined_at' => $now, 'readed_at' => $now, 'removed_at' => null, 'removed_by' => null];

                foreach ($removed_ids_full as $v) {
                    $actor->assertPermission(
                        // 确保 $localUserPivot 存在（因为 $isTryingToJoin=false 时已确保 $isMember=true）
                        // 修正：检查 $users[$v] 是否存在，防止踢出已删除用户时出错
                        $v == $actor->id || !isset($users[$v]) || $users[$v]->pivot->role < $localUserPivot->role || $isCreator
                    );
                    $removed_pairs[$v] = ['removed_at' => $now, 'removed_by' => $actor->id];
                }

                $chat->users()->syncWithoutDetaching($added_pairs + $removed_pairs);

                if (!$isChannel) {
                    $message = $this->bus->dispatch(
                        new PostEventMessage($chat->id, $actor, new EventMessageChatAddRemoveUser($added_ids_full, $removed_ids_full), $ip_address)
                    );
                    $events_list[] = $message->id;
                }
            }
        }

        $roles_updated_for = [];
        // $edited = Arr::get($data, 'attributes.users.edited', 0); // 已在顶部定义
        if ($edited) {
            $actor->assertPermission(
                !$isPM && $isCreator
            );

            $syncUsers = [];

            foreach ($edited as $user) {
                $id = $user['id'];
                $role = $user['role'];

                if (array_search($id, $all_ids) === false)
                    continue;

                if ($id == $actor->id)
                    throw new ChatEditException('Сannot set a role for yourself');

                if (!in_array($role, [0, 1, 2]))
                    throw new ChatEditException('Unacceptable role');

                $syncUsers[$id] = ['role' => $role];
                if ($role != $users[$id]->pivot->role) $roles_updated_for[] = $id;
            }

            $chat->users()->syncWithoutDetaching($syncUsers);
        }

        if ($attrsChanged) {
            $this->validator->assertValid($chat->getDirty());
            $chat->save();
        }
        $chat->eventmsg_range = $events_list;
        $chat->roles_updated_for = $roles_updated_for;

        $this->events->dispatch(
            new Saved($chat, $actor, $data, false)
        );

        return $chat;
    }
}
