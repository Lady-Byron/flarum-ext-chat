<?php
/*
 * This file is part of xelson/flarum-ext-chat
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Xelson\Chat;

use Carbon\Carbon;
use Flarum\User\User;
use Flarum\Database\AbstractModel;

class Chat extends AbstractModel
{
    protected $table = 'neonchat_chats';

    protected $dates = ['created_at'];

    /**
     * Create a new message.
     *
     * @param string    $message
     * @param int       $color
     * @param string    $icon
     * @param int    	$type
     * @param int       $creator_id
	 * @param Carbon    $created_at
     * */
    public static function build($title, $color, $icon, $type, $creator_id = null, $created_at = null)
    {
        $chat = new static;

        $chat->title = $title;
        $chat->color = $color;
        $chat->icon = $icon;
        $chat->type = $type;
        $chat->creator_id = $creator_id;
        $chat->created_at = $created_at;

        return $chat;
    }

    public function unreadedCount($chatUser)
    {
        $start = $chatUser->readed_at;
        if($start == null) $start = 0;

        $query = $this->messages()->where('created_at', '>', $start);
        if($chatUser->removed_at) 
            $query->where('created_at', '<=', $chatUser->removed_at);

        return $query->count();
    }

    public function getChatUser(User $user)
    {
        $chatUser = ChatUser::where('chat_id', $this->id)->where('user_id', $user->id)->first();
        if(!$chatUser && $user->id && $this->type == 1)
        {
            $now = Carbon::now();
            $this->users()->attach($user->id, ['readed_at' => $now]);
            $chatUser = ChatUser::build($this->id, $user->id, $now, $now);
        }
        return $chatUser;
    }

    // -------------------------------------------------------------------
    // +++ 新增方法 +++
    // -------------------------------------------------------------------

    /**
     * Get the pivot record for a specific user (non-mutating).
     * 这是一个安全的查询，它不会像 getChatUser() 那样自动创建成员资格。
     *
     * @param User $actor
     * @return ChatUser|null
     */
    public function getMembership(User $actor)
    {
        // 游客或未登录用户
        if ($actor->isGuest()) {
            return null;
        }

        return ChatUser::where('chat_id', $this->id)
                       ->where('user_id', $actor->id)
                       ->first();
    }

    /**
     * Check if the user can read/write content in this chat.
     * (Admin, or an active member).
     *
     * @param User $actor
     * @return bool
     */
    public function canAccessContent(User $actor): bool
    {
        // 1. Admin Bypass
        // 管理员可以无条件访问
        if ($actor->isAdmin()) {
            return true;
        }

        // 2. Get membership (safely)
        $membership = $this->getMembership($actor);

        // 3. Must have a membership record and must not have 'removed_at' set
        // 必须有成员记录，且 'removed_at' 必须为 null
        return $membership && is_null($membership->removed_at);
    }

    // -------------------------------------------------------------------
    // --- 保持不变的方法 ---
    // -------------------------------------------------------------------

    /**
     * @return \Illuminate\Database\Eloquent\Relations\BelongsTo
     */
    public function creator()
    {
        return $this->belongsTo(User::class, 'creator_id');
    }

    /**
     * @return \Illuminate\Database\Eloquent\Relations\BelongsToMany
     */
    public function users()
    {
        return $this->belongsToMany(User::class, 'neonchat_chat_user')->withPivot('joined_at', 'removed_by', 'role', 'readed_at', 'removed_at');
    }

    /**
     * @return \Illuminate\Database\Eloquent\Relations\hasMany
     */
    public function messages()
    {
        return $this->hasMany(Message::class);
    }

    /**
     * @return \Illuminate\Database\Eloquent\Relations\hasOne
     */
    public function last_message()
    {
        return $this->hasOne(Message::class)->orderBy('id', 'desc')->whereNull('deleted_by');
    }

    /**
     * @return \Illuminate\Database\Eloquent\Relations\hasOne
     */
    public function first_message()
    {
        return $this->hasOne(Message::class)->orderBy('id', 'asc')->whereNull('deleted_by');
    }
}
