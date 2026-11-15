#pragma once

#include <cstdint>
#include <string>
#include <variant>

namespace autoport {

struct Vec3 { float x{0}; float y{0}; float z{0}; };
enum class EntityKind { Vehicle, Ped, Object };

struct SpawnEntity { EntityKind kind; std::string model; Vec3 position; Vec3 rotation; float heading{0}; };
struct SetTransform { std::uint32_t entity{0}; Vec3 position; Vec3 rotation; float heading{0}; };
struct AttachEntity { std::uint32_t parent{0}; std::uint32_t child{0}; std::string bone; Vec3 offset; Vec3 rotation; };
struct SetVehicleProperty { std::uint32_t vehicle{0}; std::string property; float value{0}; };
struct SetWantedLevel { int level{0}; };
struct GrantReward { std::int64_t amount{0}; };
struct IssuePedTask { std::uint32_t ped{0}; std::string task; std::uint32_t target{0}; };
struct SetEntityHealth { std::uint32_t entity{0}; float health{100}; };
struct CreateExplosion { Vec3 position; int type{0}; float damageScale{1}; };

using Action = std::variant<SpawnEntity, SetTransform, AttachEntity, SetVehicleProperty, SetWantedLevel, GrantReward, IssuePedTask, SetEntityHealth, CreateExplosion>;

class GameApi {
public:
    virtual ~GameApi() = default;
    virtual std::uint32_t spawn_entity(const SpawnEntity& action) = 0;
    virtual bool set_transform(const SetTransform& action) = 0;
    virtual bool attach_entity(const AttachEntity& action) = 0;
    virtual bool set_vehicle_property(const SetVehicleProperty& action) = 0;
    virtual bool set_wanted_level(const SetWantedLevel& action) = 0;
    virtual bool grant_reward(const GrantReward& action) = 0;
    virtual bool issue_ped_task(const IssuePedTask& action) = 0;
    virtual bool set_entity_health(const SetEntityHealth& action) = 0;
    virtual bool create_explosion(const CreateExplosion& action) = 0;
};

struct DispatchResult { bool ok{false}; std::uint32_t entity{0}; std::string error; };

class Dispatcher {
public:
    explicit Dispatcher(GameApi& api) : api_(api) {}
    DispatchResult dispatch(const Action& action) const;
private:
    GameApi& api_;
};

} // namespace autoport
