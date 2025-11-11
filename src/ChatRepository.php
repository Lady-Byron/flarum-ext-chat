<?php
/*
 * This file is part of xelson/flarum-ext-chat
 */

namespace Xelson\Chat;

use Flarum\User\User;
use Illuminate\Database\Eloquent\Builder;

class ChatRepository
{
    /**
     * Base query for chats.
     */
    public function query(): Builder
    {
        return Chat::query();
    }

    /**
     * Visible chats for actor.
     *
     * Rules:
     * - Admin + scope=all  → list all.
     * - Member (any type)  → visible when pivot exists and removed_at IS NULL.
     * - Public channels (type=1) are additionally "discoverable" for:
     *     * never joined (no pivot)
     *     * left by self (pivot.removed_by = actor)
     *   but NOT for:
     *     * kicked (pivot.removed_by != actor AND removed_at NOT NULL)
     *
     * @param User        $actor
     * @param string|null $scope  'all' for admins to list everything
     */
    public function queryVisible(User $actor, ?string $scope = null): Builder
    {
        // Admin scope=all: list all chats
        if ($actor->isAdmin() && $scope === 'all') {
            return $this->query();
        }

        $actorId = (int) $actor->id;

        // Subquery: chats where actor is an active member
        $memberIds = ChatUser::query()
            ->select('chat_id')
            ->where('user_id', $actorId)
            ->whereNull('removed_at');

        // Subquery: chats where actor was kicked (not self-left)
        $kickedIds = ChatUser::query()
            ->select('chat_id')
            ->where('user_id', $actorId)
            ->whereNotNull('removed_at')
            ->where(function ($q) use ($actorId) {
                $q->whereNull('removed_by')->orWhere('removed_by', '!=', $actorId);
            });

        // Visible = active member OR (public channel AND not kicked)
        $query = $this->query()
            ->where(function (Builder $q) use ($memberIds) {
                // 1) I'm an active member
                $q->whereIn('id', $memberIds);
            })
            ->orWhere(function (Builder $q) use ($kickedIds) {
                // 2) Public channel, but exclude "kicked"
                $q->where('type', 1)
                  ->whereNotIn('id', $kickedIds);
            });

        return $query;
    }

    /**
     * Find visible chat by id (admins bypass visibility).
     */
    public function findOrFail(int $id, User $actor): Chat
    {
        if ($actor->isAdmin()) {
            return $this->query()->findOrFail($id);
        }

        return $this->queryVisible($actor)->findOrFail($id);
    }
}
