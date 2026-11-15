#include "autoport/game_api.hpp"

#include <cassert>
#include <cmath>
#include <iostream>

using namespace autoport;

class FakeGameApi final : public GameApi {
public:
    std::uint32_t spawn_entity(const SpawnEntity&) override { ++spawns; return 42; }
    bool set_transform(const SetTransform&) override { ++transforms; return true; }
    bool attach_entity(const AttachEntity&) override { ++attachments; return true; }
    bool set_vehicle_property(const SetVehicleProperty&) override { ++properties; return true; }
    bool set_wanted_level(const SetWantedLevel&) override { ++wanted; return true; }
    bool grant_reward(const GrantReward&) override { ++rewards; return true; }
    bool issue_ped_task(const IssuePedTask&) override { ++tasks; return true; }
    bool set_entity_health(const SetEntityHealth&) override { ++health; return true; }
    bool create_explosion(const CreateExplosion&) override { ++explosions; return true; }
    int spawns{0}, transforms{0}, attachments{0}, properties{0}, wanted{0}, rewards{0}, tasks{0}, health{0}, explosions{0};
};

int main() {
    FakeGameApi api;
    Dispatcher dispatcher(api);
    const auto spawned = dispatcher.dispatch(SpawnEntity{EntityKind::Vehicle, "adder", {1,2,3}, {0,0,0}, 90});
    assert(spawned.ok && spawned.entity == 42 && api.spawns == 1);
    const auto bad_model = dispatcher.dispatch(SpawnEntity{EntityKind::Vehicle, "", {1,2,3}, {0,0,0}, 0});
    assert(!bad_model.ok && api.spawns == 1);
    const auto bad_vector = dispatcher.dispatch(SetTransform{42, {NAN,0,0}, {0,0,0}, 0});
    assert(!bad_vector.ok && api.transforms == 0);
    assert(dispatcher.dispatch(AttachEntity{42, 43, "chassis", {0,1,0}, {0,0,0}}).ok);
    assert(dispatcher.dispatch(SetVehicleProperty{42, "livery", 2}).ok);
    assert(dispatcher.dispatch(SetWantedLevel{5}).ok);
    assert(!dispatcher.dispatch(SetWantedLevel{6}).ok);
    assert(dispatcher.dispatch(GrantReward{500}).ok);
    assert(!dispatcher.dispatch(GrantReward{-1}).ok);
    assert(dispatcher.dispatch(IssuePedTask{55, "follow_player", 0}).ok);
    assert(dispatcher.dispatch(SetEntityHealth{55, 175}).ok);
    assert(!dispatcher.dispatch(SetEntityHealth{55, 10001}).ok);
    assert(dispatcher.dispatch(CreateExplosion{{1,2,3}, 2, 1.0f}).ok);
    assert(!dispatcher.dispatch(CreateExplosion{{1,2,3}, 2, 99.0f}).ok);
    std::cout << "native runtime core tests passed\\n";
    return 0;
}
